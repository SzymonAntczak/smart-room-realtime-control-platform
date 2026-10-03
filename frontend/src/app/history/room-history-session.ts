import {
    compareRecentEventsDescending,
    isHistoryCursorErrorResponse,
    isRawTelemetryPage,
    type LiveTelemetrySampleProjection,
    normalizeRawTelemetryFirstPageQuery,
    type RawTelemetryPage,
} from '@smart-room/contracts/history';

import type { RoomHistoryRealtimeUpdate } from '../realtime/room-realtime-client';

const defaultBffUrl = 'http://localhost:4310';
const telemetryLimit = 100;

type HistoryKind = 'telemetry';
type HistoryItem = LiveTelemetrySampleProjection;
type HistoryPage = RawTelemetryPage;

export type RoomHistorySessionOptions = {
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
    connectionInterrupted(): void;
    close(): void;
}

/** One open, bounded history range. Connect SSE before calling loadFirstPage. */
export function createRoomHistorySession(
    options: RoomHistorySessionOptions,
    fetchImplementation: typeof fetch = fetch,
): RoomHistorySession {
    const limit = telemetryLimit;
    const pageSize = options.pageSize ?? limit;

    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > limit) {
        throw new Error('History page size is outside the view bound.');
    }

    const parsedQuery = normalizeRawTelemetryFirstPageQuery({
        deviceId: options.deviceId,
        metric: options.metric,
        from: options.from,
        to: options.to,
        pageSize,
    });

    if (!parsedQuery) {
        throw new Error('Telemetry history range did not match the shared query contract.');
    }

    const telemetryQuery = parsedQuery;

    let status: RoomHistorySessionState['status'] = 'waiting_for_baseline';
    let error: RoomHistorySessionState['error'];
    let generation: string | null = null;
    let throughSequence: number | null = null;
    let retentionAsOf: string | null = null;
    let nextCursor: string | null = null;
    let hasPage = false;
    let hasBaseline = false;
    let hasOpened = false;
    let awaitingBaseline = false;
    let requestInFlight = false;
    let requestEpoch = 0;
    let pageItems: HistoryItem[] = [];
    let overlay: HistoryItem[] = [];
    let retainedItems: HistoryItem[] | undefined;
    let retainedGeneration: string | null = null;

    return {
        acceptRealtime(update) {
            if (update.kind === 'interrupted') {
                interruptConnection();

                return;
            }

            if (status === 'closed' || (status === 'error' && error !== 'history_unavailable')) {
                return;
            }

            const incomingGeneration = update.storage.historyGenerationId;

            if (update.kind === 'baseline') {
                const generationChanged =
                    incomingGeneration !== null &&
                    generation !== null &&
                    incomingGeneration !== generation;

                if (
                    hasBaseline &&
                    !awaitingBaseline &&
                    !generationChanged &&
                    !(status === 'error' && error === 'history_unavailable')
                ) {
                    fail('invalid_response');

                    return;
                }

                if (generationChanged && !awaitingBaseline) {
                    retainCurrentView();
                }

                if (incomingGeneration !== null) {
                    generation = incomingGeneration;
                }

                pageItems = [];
                overlay = [];
                hasPage = false;
                throughSequence = null;
                retentionAsOf = null;
                nextCursor = null;
                error = generationChanged ? 'generation_changed' : undefined;
                hasBaseline = true;
                awaitingBaseline = false;

                if (hasOpened) {
                    status = 'loading';
                    void loadPage(null);
                } else {
                    status = 'idle';
                    retainedItems = undefined;
                }

                return;
            }

            if (!hasBaseline || awaitingBaseline || status === 'waiting_for_baseline') {
                return;
            }

            const recovered =
                status === 'error' &&
                error === 'history_unavailable' &&
                update.storage.status === 'available';

            if (recovered) {
                retainCurrentView();
                resetPinnedSession();
                error = undefined;
                status = 'loading';
            }

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

            if (
                update.telemetrySample &&
                update.telemetrySample.deviceId === telemetryQuery.deviceId &&
                update.telemetrySample.metric === telemetryQuery.metric &&
                update.telemetrySample.occurredAt >= telemetryQuery.from &&
                update.telemetrySample.occurredAt < telemetryQuery.to
            ) {
                overlay = mergeBounded(overlay, [update.telemetrySample], limit);
            }

            if (recovered) {
                void loadPage(null);
            }
        },
        async loadFirstPage() {
            if (status !== 'idle' || hasPage || requestInFlight) {
                throw new Error('History first page requires a live baseline and an idle session.');
            }

            hasOpened = true;
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
                items: retainedItems ?? mergeBounded(pageItems, overlay, limit),
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
            retainedItems = undefined;
            nextCursor = null;
        },
        connectionInterrupted: interruptConnection,
    };

    async function loadPage(cursor: string | null): Promise<void> {
        status = 'loading';
        requestInFlight = true;
        const epoch = ++requestEpoch;

        try {
            const url = new URL('/room/history/telemetry', getBffUrl());
            url.searchParams.set('pageSize', String(pageSize));

            url.searchParams.set('deviceId', telemetryQuery.deviceId);
            url.searchParams.set('metric', telemetryQuery.metric);
            url.searchParams.set('from', telemetryQuery.from);
            url.searchParams.set('to', telemetryQuery.to);

            if (cursor !== null) {
                url.searchParams.set('cursor', cursor);
            }

            const response = await fetchImplementation(url.toString());

            if (isInactive(epoch)) {
                return;
            }

            if (response.status === 503) {
                if (retainedItems !== undefined && retainedGeneration === generation) {
                    retainedItems = mergeBounded(
                        retainedItems,
                        mergeBounded(pageItems, overlay, limit),
                        limit,
                    );
                }

                fail('history_unavailable');

                return;
            }

            if (response.status === 400 && cursor !== null) {
                const errorBody: unknown = await response.json();

                if (isInactive(epoch)) {
                    return;
                }

                if (
                    isHistoryCursorErrorResponse(errorBody) &&
                    (errorBody.error === 'cursor_expired' || errorBody.error === 'invalid_cursor')
                ) {
                    retainCurrentView();
                    resetPinnedSession();
                    status = 'loading';
                    await loadPage(null);

                    return;
                }

                if (
                    isHistoryCursorErrorResponse(errorBody) &&
                    errorBody.error === 'history_generation_changed'
                ) {
                    retainCurrentView();
                    resetPinnedSession();
                    requestEpoch += 1;
                    requestInFlight = false;
                    error = 'generation_changed';
                    status = 'waiting_for_baseline';
                    awaitingBaseline = true;

                    return;
                }

                fail('invalid_response');

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

            const valid = isRawTelemetryPage(body);

            if (!valid) {
                fail('invalid_response');

                return;
            }

            const page = body as HistoryPage;

            if (generation !== null && page.historyGenerationId !== generation) {
                retainCurrentView();
                resetPinnedSession();
                requestEpoch += 1;
                requestInFlight = false;
                awaitingBaseline = true;
                error = 'generation_changed';
                status = 'waiting_for_baseline';

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
            pageItems = hasPage
                ? mergeBounded(pageItems, page.items, limit)
                : mergeBounded([], page.items, limit);
            hasPage = true;
            retainedItems = undefined;
            error = undefined;
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
            page.items.every(
                (item) =>
                    item.deviceId === telemetryQuery.deviceId &&
                    item.metric === telemetryQuery.metric &&
                    item.occurredAt >= telemetryQuery.from &&
                    item.occurredAt < telemetryQuery.to,
            )
        );
    }

    function fail(reason: NonNullable<RoomHistorySessionState['error']>): void {
        requestEpoch += 1;
        requestInFlight = false;
        status = 'error';
        error = reason;
    }

    function interruptConnection(): void {
        if (status === 'closed' || !hasBaseline || awaitingBaseline) {
            return;
        }

        retainCurrentView();
        resetPinnedSession();
        requestEpoch += 1;
        requestInFlight = false;
        error = undefined;
        status = 'waiting_for_baseline';
        awaitingBaseline = true;
    }

    function retainCurrentView(): void {
        retainedItems = mergeBounded(pageItems, overlay, limit);
        retainedGeneration = generation;
    }

    function resetPinnedSession(): void {
        pageItems = [];
        hasPage = false;
        throughSequence = null;
        retentionAsOf = null;
        nextCursor = null;
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
