import type { RawTelemetryPage, RawTelemetrySampleProjection } from '@smart-room/contracts/history';

import { createTelemetryHistoryClient, type TelemetryHistoryClient } from '../../api/history';
import type { DeviceFilterCriteria } from '../../features/device-filters';
import { createInfiniteSession, type InfiniteSource } from '../../features/infinite-scrolling';

const duration = 30 * 24 * 60 * 60 * 1000;
type Error = 'unavailable' | 'invalid_response' | 'request_failed' | 'cursor_error' | 'limit';
interface Metadata {
    range: { from: string; to: string };
    pin: Pick<RawTelemetryPage, 'historyGenerationId' | 'throughSequence' | 'retentionAsOf'>;
}

export function resolveTelemetryRange(criteria: DeviceFilterCriteria, now: number) {
    const to = criteria.to ?? new Date(now).toISOString();
    const from = criteria.from ?? new Date(Date.parse(to) - duration).toISOString();

    return Number.isFinite(Date.parse(from)) && Date.parse(from) < Date.parse(to)
        ? { from, to }
        : null;
}

/** A durable-only snapshot, independent of the chart and room realtime source. */
export function createTelemetrySearchSession(
    deviceId: string,
    client: TelemetryHistoryClient = createTelemetryHistoryClient(),
    now: () => number = Date.now,
) {
    const core = createInfiniteSession<RawTelemetrySampleProjection, Metadata, Error>({
        getItemKey: (item) => item.recordId,
        maxItems: 10000,
        maxPages: 100,
        duplicates: 'reject',
        errors: {
            invalidResponse: 'invalid_response',
            requestFailed: 'request_failed',
            limit: 'limit',
        },
    });

    return {
        ...core,
        search(criteria: DeviceFilterCriteria): Promise<boolean> {
            if (core.getState().status === 'closed' || !resolveTelemetryRange(criteria, now())) {
                return Promise.resolve(false);
            }

            const applied = { ...criteria };

            return core
                .start((): InfiniteSource<RawTelemetrySampleProjection, Metadata, Error> => {
                    const range = resolveTelemetryRange(applied, now());

                    return {
                        async readPage({ cursor, signal, items, metadata }) {
                            if (!range) {
                                return {
                                    kind: 'error',
                                    error: 'invalid_response',
                                    recovery: 'refresh',
                                };
                            }

                            const result = await client.readPage(
                                {
                                    deviceId,
                                    metric: 'temperature',
                                    pageSize: 100,
                                    ...range,
                                    ...(cursor ? { cursor } : {}),
                                },
                                signal,
                            );

                            if (result.kind !== 'page') {
                                return {
                                    kind: 'error',
                                    error:
                                        result.kind === 'cursor_error'
                                            ? 'cursor_error'
                                            : result.kind,
                                    recovery: result.kind === 'cursor_error' ? 'refresh' : 'retry',
                                };
                            }

                            const page = result.page;
                            const pin = metadata?.pin;
                            const previous = items.at(-1);
                            const newest = page.items[0];
                            const sequences = new Set(items.map((item) => item.storageSequence));

                            if (
                                page.pageSize !== 100 ||
                                (pin &&
                                    (pin.historyGenerationId !== page.historyGenerationId ||
                                        pin.throughSequence !== page.throughSequence ||
                                        pin.retentionAsOf !== page.retentionAsOf))
                            ) {
                                return {
                                    kind: 'error',
                                    error: 'invalid_response',
                                    recovery: 'refresh',
                                };
                            }

                            if (
                                page.items.some((item) => sequences.has(item.storageSequence)) ||
                                (previous &&
                                    newest &&
                                    (Date.parse(newest.occurredAt) >
                                        Date.parse(previous.occurredAt) ||
                                        (Date.parse(newest.occurredAt) ===
                                            Date.parse(previous.occurredAt) &&
                                            newest.storageSequence >= previous.storageSequence)))
                            ) {
                                return {
                                    kind: 'error',
                                    error: 'invalid_response',
                                    recovery: 'retry',
                                };
                            }

                            return {
                                kind: 'page',
                                items: page.items,
                                nextCursor: page.nextCursor,
                                metadata: {
                                    range,
                                    pin: {
                                        historyGenerationId: page.historyGenerationId,
                                        throughSequence: page.throughSequence,
                                        retentionAsOf: page.retentionAsOf,
                                    },
                                },
                            };
                        },
                    };
                })
                .then(() => true);
        },
    };
}
