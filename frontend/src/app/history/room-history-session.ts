import {
    compareRecentEventsDescending,
    isRawTelemetryPage,
    isSignificantFactPage,
    type LiveTelemetrySampleProjection,
    normalizeRawTelemetryFirstPageQuery,
    type RawTelemetryPage,
    type RecentEventProjection,
    type SignificantFactPage,
} from '@smart-room/contracts/history';

import type { RoomHistoryRealtimeUpdate } from '../realtime/room-realtime-client';

const defaultBffUrl = 'http://localhost:4310';
const factLimit = 20;
const telemetryLimit = 100;

type HistoryKind = 'significant-facts' | 'telemetry';
type HistoryItem = RecentEventProjection | LiveTelemetrySampleProjection;
type HistoryPage = SignificantFactPage | RawTelemetryPage;

export type RoomHistorySessionOptions =
    | { kind: 'significant-facts'; pageSize?: number }
    | {
          kind: 'telemetry';
          deviceId: string;
          metric: 'temperature';
          from: string;
          to: string;
          pageSize?: number;
      };

export interface RoomHistorySessionState {
    kind: HistoryKind;
    status: 'waiting_for_baseline' | 'idle' | 'loading' | 'ready' | 'error' | 'closed';
    items: readonly HistoryItem[];
    historyGenerationId: string | null;
    throughSequence: number | null;
    nextCursor: string | null;
    complete: boolean;
    error?: 'history_unavailable' | 'invalid_response' | 'generation_changed' | 'request_failed';
}

export interface RoomHistorySession {
    acceptRealtime(update: RoomHistoryRealtimeUpdate): void;
    loadFirstPage(): Promise<void>;
    loadNextPage(): Promise<void>;
    getState(): RoomHistorySessionState;
    close(): void;
}

/** One open, bounded history range. Connect SSE before calling loadFirstPage. */
export function createRoomHistorySession(
    options: RoomHistorySessionOptions,
    fetchImplementation: typeof fetch = fetch,
): RoomHistorySession {
    const limit = options.kind === 'significant-facts' ? factLimit : telemetryLimit;
    const pageSize = options.pageSize ?? limit;

    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > limit) {
        throw new Error('History page size is outside the view bound.');
    }

    const telemetryQuery =
        options.kind === 'telemetry'
            ? normalizeRawTelemetryFirstPageQuery({
                  deviceId: options.deviceId,
                  metric: options.metric,
                  from: options.from,
                  to: options.to,
                  pageSize,
              })
            : undefined;

    if (options.kind === 'telemetry' && !telemetryQuery) {
        throw new Error('Telemetry history range did not match the shared query contract.');
    }

    let status: RoomHistorySessionState['status'] = 'waiting_for_baseline';
    let error: RoomHistorySessionState['error'];
    let generation: string | null = null;
    let throughSequence: number | null = null;
    let retentionAsOf: string | null = null;
    let nextCursor: string | null = null;
    let hasPage = false;
    let requestInFlight = false;
    let requestEpoch = 0;
    let pageItems: HistoryItem[] = [];
    let overlay: HistoryItem[] = [];

    return {
        acceptRealtime(update) {
            if (status === 'closed' || (status === 'error' && error !== 'history_unavailable')) {
                return;
            }

            const incomingGeneration = update.storage.historyGenerationId;

            if (
                incomingGeneration !== null &&
                generation !== null &&
                incomingGeneration !== generation
            ) {
                fail('generation_changed');

                return;
            }

            if (incomingGeneration !== null) {
                generation = incomingGeneration;
            }

            if (update.kind === 'baseline') {
                if (status !== 'waiting_for_baseline') {
                    fail('invalid_response');

                    return;
                }

                status = 'idle';

                if (options.kind === 'significant-facts') {
                    overlay = mergeBounded(overlay, update.recentEvents, limit);
                }

                return;
            }

            if (status === 'waiting_for_baseline') {
                return;
            }

            if (options.kind === 'significant-facts') {
                overlay = mergeBounded(overlay, update.recentEvents ?? [], limit);
            } else if (
                update.telemetrySample &&
                telemetryQuery &&
                update.telemetrySample.deviceId === telemetryQuery.deviceId &&
                update.telemetrySample.metric === telemetryQuery.metric &&
                update.telemetrySample.occurredAt >= telemetryQuery.from &&
                update.telemetrySample.occurredAt < telemetryQuery.to
            ) {
                overlay = mergeBounded(overlay, [update.telemetrySample], limit);
            }
        },
        async loadFirstPage() {
            if (status !== 'idle' || hasPage || requestInFlight) {
                throw new Error('History first page requires a live baseline and an idle session.');
            }

            await loadPage(null);
        },
        async loadNextPage() {
            if (status !== 'ready' || !hasPage || requestInFlight) {
                throw new Error('History next page requires a ready session.');
            }

            if (nextCursor !== null) {
                await loadPage(nextCursor);
            }
        },
        getState() {
            return {
                kind: options.kind,
                status,
                items: mergeBounded(pageItems, overlay, limit),
                historyGenerationId: generation,
                throughSequence,
                nextCursor,
                complete: status === 'ready' && hasPage && nextCursor === null,
                ...(error === undefined ? {} : { error }),
            };
        },
        close() {
            requestEpoch += 1;
            status = 'closed';
            pageItems = [];
            overlay = [];
            nextCursor = null;
        },
    };

    async function loadPage(cursor: string | null): Promise<void> {
        status = 'loading';
        requestInFlight = true;
        const epoch = ++requestEpoch;

        try {
            const url = new URL(
                options.kind === 'significant-facts'
                    ? '/room/history/significant-facts'
                    : '/room/history/telemetry',
                getBffUrl(),
            );
            url.searchParams.set('pageSize', String(pageSize));

            if (telemetryQuery) {
                url.searchParams.set('deviceId', telemetryQuery.deviceId);
                url.searchParams.set('metric', telemetryQuery.metric);
                url.searchParams.set('from', telemetryQuery.from);
                url.searchParams.set('to', telemetryQuery.to);
            }

            if (cursor !== null) {
                url.searchParams.set('cursor', cursor);
            }

            const response = await fetchImplementation(url.toString());

            if (isInactive(epoch)) {
                return;
            }

            if (response.status === 503) {
                fail('history_unavailable');

                return;
            }

            if (!response.ok) {
                fail('invalid_response');

                return;
            }

            const body: unknown = await response.json();

            if (isInactive(epoch)) {
                return;
            }

            const valid =
                options.kind === 'significant-facts'
                    ? isSignificantFactPage(body)
                    : isRawTelemetryPage(body);

            if (!valid) {
                fail('invalid_response');

                return;
            }

            const page = body as HistoryPage;

            if (generation !== null && page.historyGenerationId !== generation) {
                fail('generation_changed');

                return;
            }

            if (!hasMatchingPage(page)) {
                fail('invalid_response');

                return;
            }

            generation = page.historyGenerationId;
            throughSequence = page.throughSequence;
            retentionAsOf = page.retentionAsOf;
            nextCursor = page.nextCursor;
            pageItems = mergeBounded(pageItems, page.items, limit);
            hasPage = true;
            status = 'ready';
        } catch {
            if (!isInactive(epoch)) {
                fail('request_failed');
            }
        } finally {
            if (epoch === requestEpoch) {
                requestInFlight = false;
            }
        }
    }

    function hasMatchingPage(page: HistoryPage): boolean {
        return (
            page.pageSize === pageSize &&
            (!hasPage ||
                (page.historyGenerationId === generation &&
                    page.throughSequence === throughSequence &&
                    page.retentionAsOf === retentionAsOf)) &&
            (options.kind !== 'telemetry' ||
                (telemetryQuery !== undefined &&
                    page.items.every(
                        (item) =>
                            'deviceId' in item &&
                            item.deviceId === telemetryQuery.deviceId &&
                            'metric' in item &&
                            item.metric === telemetryQuery.metric &&
                            item.occurredAt >= telemetryQuery.from &&
                            item.occurredAt < telemetryQuery.to,
                    )))
        );
    }

    function fail(reason: NonNullable<RoomHistorySessionState['error']>): void {
        requestEpoch += 1;
        requestInFlight = false;
        status = 'error';
        error = reason;
    }

    function isInactive(epoch: number): boolean {
        return epoch !== requestEpoch || status === 'closed' || status === 'error';
    }
}

function mergeBounded(
    current: readonly HistoryItem[],
    additions: readonly HistoryItem[],
    limit: number,
): HistoryItem[] {
    const byRecordId = new Map(current.map((item) => [item.recordId, item]));

    for (const item of additions) {
        const existing = byRecordId.get(item.recordId);

        if (!existing || item.durability === 'durable' || existing.durability !== 'durable') {
            byRecordId.set(item.recordId, item);
        }
    }

    return [...byRecordId.values()].sort(compareRecentEventsDescending).slice(0, limit);
}

function getBffUrl(): string {
    return (import.meta.env.VITE_BFF_URL ?? defaultBffUrl).replace(/\/+$/u, '');
}
