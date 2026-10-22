import {
    compareRecentEventsDescending,
    type RawTelemetryPage,
    type RawTelemetryPageQuery,
    type RawTelemetrySampleProjection,
} from '@smart-room/contracts/history';

import { createTelemetryHistoryClient, type TelemetryHistoryClient } from '../../api/history';

const pageSize = 100;
const sampleLimit = 200;
const rangeDuration = 30 * 24 * 60 * 60 * 1000;

interface TelemetryState {
    deviceId: string;
    status: 'idle' | 'loading' | 'ready' | 'error' | 'closed';
    samples: readonly RawTelemetrySampleProjection[];
    range: { from: string; to: string } | null;
    pin: Pick<RawTelemetryPage, 'historyGenerationId' | 'throughSequence' | 'retentionAsOf'> | null;
    limitReached: boolean;
    lastKnown: boolean;
    error: 'unavailable' | 'invalid_response' | 'request_failed' | 'cursor_error' | null;
}

/** One bounded HTTP baseline; it neither subscribes to nor buffers live telemetry. */
export function createTelemetrySession(
    deviceId: string,
    client: TelemetryHistoryClient = createTelemetryHistoryClient(),
    now: () => number = Date.now,
) {
    let state: TelemetryState = {
        deviceId,
        status: 'idle',
        samples: [],
        range: null,
        pin: null,
        limitReached: false,
        lastKnown: false,
        error: null,
    };
    let epoch = 0;
    let controller: AbortController | undefined;
    let operation: Promise<void> | undefined;
    const listeners = new Set<() => void>();

    const session = {
        getState: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);

            return () => listeners.delete(listener);
        },
        start(): Promise<void> {
            if (state.status === 'closed' || state.status === 'loading') {
                return operation ?? Promise.resolve();
            }

            const to = now();
            const range = {
                from: new Date(to - rangeDuration).toISOString(),
                to: new Date(to).toISOString(),
            };
            const currentEpoch = ++epoch;
            controller = new AbortController();
            update({
                status: 'loading',
                samples: [],
                pin: null,
                range,
                lastKnown: false,
                error: null,
                limitReached: false,
            });
            operation = readBaseline(
                { deviceId, metric: 'temperature', pageSize, ...range },
                currentEpoch,
                controller.signal,
            );

            return operation;
        },
        close() {
            epoch += 1;
            controller?.abort();
            controller = undefined;
            operation = undefined;
            update({
                status: 'closed',
                samples: [],
                range: null,
                pin: null,
                lastKnown: false,
                limitReached: false,
                error: null,
            });
            listeners.clear();
        },
    };

    return session;

    async function readBaseline(
        query: RawTelemetryPageQuery,
        currentEpoch: number,
        signal: AbortSignal,
    ) {
        let cursor: string | undefined;
        let pin: TelemetryState['pin'] = null;
        let previousOldest: RawTelemetrySampleProjection | undefined;
        let pages = 0;
        let restarted = false;

        while (active()) {
            try {
                const result = await client.readPage(
                    { ...query, ...(cursor ? { cursor } : {}) },
                    signal,
                );

                if (!active()) {
                    return;
                }

                if (result.kind === 'cursor_error') {
                    if (!restarted && result.error.error !== 'cursor_query_mismatch') {
                        restarted = true;
                        cursor = undefined;
                        pin = null;
                        previousOldest = undefined;
                        pages = 0;
                        update({ lastKnown: state.samples.length > 0 });
                        continue;
                    }

                    fail('cursor_error');

                    return;
                }

                if (result.kind !== 'page') {
                    fail(result.kind);

                    return;
                }

                const page = result.page;
                const continuation = pin !== null;
                const existing = continuation ? state.samples : [];
                const ids = new Set(existing.map((sample) => sample.recordId));
                const sequences = new Set(existing.map((sample) => sample.storageSequence));
                const newest = page.items[0];
                const ordered =
                    previousOldest === undefined ||
                    newest === undefined ||
                    Date.parse(newest.occurredAt) < Date.parse(previousOldest.occurredAt) ||
                    (newest.occurredAt === previousOldest.occurredAt &&
                        newest.storageSequence < previousOldest.storageSequence);

                if (
                    page.pageSize !== pageSize ||
                    (pin !== null &&
                        (page.historyGenerationId !== pin.historyGenerationId ||
                            page.throughSequence !== pin.throughSequence ||
                            page.retentionAsOf !== pin.retentionAsOf)) ||
                    page.items.some(
                        (sample) =>
                            ids.has(sample.recordId) || sequences.has(sample.storageSequence),
                    ) ||
                    !ordered ||
                    (page.nextCursor !== null && page.nextCursor === cursor) ||
                    existing.length + page.items.length > sampleLimit
                ) {
                    fail('invalid_response');

                    return;
                }

                pin = {
                    historyGenerationId: page.historyGenerationId,
                    throughSequence: page.throughSequence,
                    retentionAsOf: page.retentionAsOf,
                };
                previousOldest = page.items.at(-1) ?? previousOldest;
                pages += 1;
                const samples = [...existing, ...page.items].sort((a, b) =>
                    compareRecentEventsDescending(b, a),
                );
                const complete =
                    page.nextCursor === null || samples.length >= sampleLimit || pages >= 2;
                update({
                    samples,
                    pin,
                    lastKnown: false,
                    status: complete ? 'ready' : 'loading',
                    limitReached: complete && page.nextCursor !== null,
                });

                if (complete) {
                    return;
                }

                cursor = page.nextCursor ?? undefined;
            } catch {
                if (active()) {
                    fail('request_failed');
                }

                return;
            }
        }

        function active() {
            return epoch === currentEpoch && state.status !== 'closed';
        }

        function fail(error: NonNullable<TelemetryState['error']>) {
            update({ status: 'error', error, lastKnown: state.samples.length > 0 });
        }
    }

    function update(change: Partial<TelemetryState>) {
        state = { ...state, ...change };

        for (const listener of listeners) {
            listener();
        }
    }
}
