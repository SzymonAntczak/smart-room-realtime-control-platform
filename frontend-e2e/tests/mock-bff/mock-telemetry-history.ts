import {
    type HistoryCursorErrorResponse,
    isHistoryCursorErrorResponse,
    isRawTelemetryPage,
    normalizeRawTelemetryPageQuery,
    type RawTelemetryPage,
} from '@smart-room/contracts/history';

type TelemetryResponse =
    | { status: 200; body: RawTelemetryPage }
    | { status: 400; body: HistoryCursorErrorResponse };

type StoragePin = Pick<RawTelemetryPage, 'historyGenerationId' | 'throughSequence'>;

/** Serves scripted pages through the same HTTP boundary as the production API. */
export class MockTelemetryHistory {
    #pages: RawTelemetryPage[] = [];
    #nextError: HistoryCursorErrorResponse | undefined;
    #holdNext = false;
    #held: (() => void) | undefined;

    configure(value: unknown) {
        if (typeof value !== 'object' || value === null) {
            throw new Error('Invalid mock telemetry history control');
        }

        const pages = 'pages' in value ? validatePages(value.pages) : this.#pages;
        const error = 'error' in value ? validateError(value.error) : this.#nextError;
        this.#pages = pages;
        this.#nextError = error;

        if ('hold' in value && value.hold === true) {
            this.#holdNext = true;
        }

        if ('release' in value && value.release === true) {
            this.#release();
        }
    }

    hasHeldResponse() {
        return this.#held !== undefined;
    }

    reset() {
        this.#release();
        this.#pages = [];
        this.#nextError = undefined;
        this.#holdNext = false;
    }

    read(url: URL, pin: StoragePin): Promise<TelemetryResponse> {
        const parameters = Object.fromEntries(url.searchParams);
        const query = normalizeRawTelemetryPageQuery({
            ...parameters,
            pageSize: Number(parameters.pageSize),
        });

        if (!query || Object.keys(parameters).length !== url.searchParams.size) {
            throw new Error('Invalid mock telemetry history query');
        }

        const index =
            query.cursor === undefined
                ? 0
                : this.#pages.findIndex((page) => page.nextCursor === query.cursor) + 1;
        const page = this.#pages[index] ?? {
            ...pin,
            pageSize: query.pageSize,
            retentionAsOf: new Date(query.to).toISOString(),
            items: [],
            nextCursor: null,
        };
        const error = this.#nextError;

        if (
            !error &&
            ((query.cursor !== undefined && index === 0) ||
                page.pageSize !== query.pageSize ||
                page.items.some(
                    (sample) =>
                        sample.deviceId !== query.deviceId ||
                        sample.metric !== query.metric ||
                        Date.parse(sample.occurredAt) < Date.parse(query.from) ||
                        Date.parse(sample.occurredAt) >= Date.parse(query.to),
                ))
        ) {
            throw new Error('Mock telemetry page does not match the requested scope');
        }

        const response: TelemetryResponse = error
            ? { status: 400, body: error }
            : { status: 200, body: page };

        if (!this.#holdNext) {
            this.#nextError = undefined;

            return Promise.resolve(response);
        }

        if (this.hasHeldResponse()) {
            throw new Error('A mock telemetry response is already held');
        }

        this.#nextError = undefined;
        this.#holdNext = false;

        return new Promise((resolve) => {
            this.#held = () => resolve(response);
        });
    }

    #release() {
        const held = this.#held;
        this.#held = undefined;
        held?.();
    }
}

function validatePages(value: unknown): RawTelemetryPage[] {
    if (!Array.isArray(value) || !value.every(isRawTelemetryPage)) {
        throw new Error('Invalid mock telemetry history pages');
    }

    const [first] = value;
    const cursors = value.slice(0, -1).map((page) => page.nextCursor);

    if (
        cursors.includes(null) ||
        new Set(cursors).size !== cursors.length ||
        (first &&
            (value.at(-1)?.nextCursor !== null ||
                value.some(
                    (page) =>
                        page.pageSize !== first.pageSize ||
                        page.historyGenerationId !== first.historyGenerationId ||
                        page.throughSequence !== first.throughSequence ||
                        page.retentionAsOf !== first.retentionAsOf,
                )))
    ) {
        throw new Error('Inconsistent mock telemetry history pages');
    }

    return structuredClone(value);
}

function validateError(value: unknown): HistoryCursorErrorResponse {
    if (!isHistoryCursorErrorResponse(value)) {
        throw new Error('Invalid mock telemetry history error');
    }

    return value;
}
