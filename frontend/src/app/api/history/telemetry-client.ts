import {
    type HistoryCursorErrorResponse,
    isHistoryCursorErrorResponse,
    isRawTelemetryPage,
    type RawTelemetryPage,
    type RawTelemetryPageQuery,
} from '@smart-room/contracts/history';
import {
    type DurableHistoryUnavailableResponse,
    isDurableHistoryUnavailableResponse,
} from '@smart-room/contracts/user-history';

type TelemetryHistoryResult =
    | { kind: 'page'; page: RawTelemetryPage }
    | { kind: 'cursor_error'; error: HistoryCursorErrorResponse }
    | { kind: 'unavailable'; error: DurableHistoryUnavailableResponse }
    | { kind: 'invalid_response' };

export interface TelemetryHistoryClient {
    readPage(query: RawTelemetryPageQuery, signal?: AbortSignal): Promise<TelemetryHistoryResult>;
}

export function createTelemetryHistoryClient(
    fetchImplementation: typeof fetch = fetch,
): TelemetryHistoryClient {
    return {
        async readPage(query, signal) {
            const url = new URL(
                '/room/history/telemetry',
                (import.meta.env.VITE_BFF_URL ?? 'http://localhost:4310').replace(/\/+$/u, ''),
            );

            for (const [key, value] of Object.entries(query)) {
                if (value !== undefined) {
                    url.searchParams.set(key, String(value));
                }
            }

            const response = await fetchImplementation(url.toString(), { signal });
            let body: unknown;

            try {
                body = await response.json();
            } catch {
                return { kind: 'invalid_response' };
            }

            if (response.status === 200 && isRawTelemetryPage(body)) {
                const matches =
                    body.pageSize === query.pageSize &&
                    body.items.every(
                        (sample) =>
                            sample.deviceId === query.deviceId &&
                            sample.metric === query.metric &&
                            Date.parse(sample.occurredAt) >= Date.parse(query.from) &&
                            Date.parse(sample.occurredAt) < Date.parse(query.to),
                    );

                return matches ? { kind: 'page', page: body } : { kind: 'invalid_response' };
            }

            if (response.status === 400 && isHistoryCursorErrorResponse(body)) {
                return { kind: 'cursor_error', error: body };
            }

            if (response.status === 503 && isDurableHistoryUnavailableResponse(body)) {
                return { kind: 'unavailable', error: body };
            }

            return { kind: 'invalid_response' };
        },
    };
}
