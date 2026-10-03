import {
    compareUserHistoryDescending,
    type UserHistoryItem,
    type UserHistoryPage,
} from '@smart-room/contracts/user-history';

import type { RoomHistoryRealtimeUpdate } from '../realtime/room-realtime-client';

import { validateUserHistoryResponse } from './user-history-client';

export const userHistoryLimits = { pageSize: 50, pages: 100, items: 5000, overlay: 200 } as const;

export interface UserHistoryReadingPosition {
    recordId: string;
    occurredAt: string;
    offsetPx: number;
}
type HistoryError =
    | 'history_unavailable'
    | 'invalid_response'
    | 'request_failed'
    | 'recovery_limit'
    | 'cursor_query_mismatch';
export interface UserHistorySessionState {
    status: 'waiting_for_baseline' | 'idle' | 'loading' | 'ready' | 'error' | 'closed';
    items: readonly UserHistoryItem[];
    historyGenerationId: string | null;
    throughSequence: number | null;
    retentionAsOf: string | null;
    nextCursor: string | null;
    endReached: boolean;
    lastKnown: boolean;
    overlayOverflow: boolean;
    hasNewEvents: boolean;
    position: UserHistoryReadingPosition | null;
    notice: 'anchor_unavailable' | 'generation_changed' | null;
    error: HistoryError | null;
}
export interface UserHistorySession {
    getState(): UserHistorySessionState;
    subscribe(listener: () => void): () => void;
    acceptRealtime(update: RoomHistoryRealtimeUpdate): void;
    loadNextPage(): Promise<void>;
    retry(): Promise<void>;
    refreshToNewest(): Promise<void>;
    updateReadingPosition(position: UserHistoryReadingPosition | null): void;
    close(): void;
}

/** One pinned HTTP dataset plus a bounded overlay from the existing room SSE. */
export function createUserHistorySession(
    fetchImplementation: typeof fetch = fetch,
    requestBaseline: () => void = () => undefined,
): UserHistorySession {
    let status: UserHistorySessionState['status'] = 'waiting_for_baseline';
    let error: HistoryError | null = null;
    let generation: string | null = null;
    let throughSequence: number | null = null;
    let retentionAsOf: string | null = null;
    let nextCursor: string | null = null;
    let hasPage = false;
    let acceptedPages = 0;
    const pageCursors = new Set<string>();
    let hasBaseline = false;
    let opened = false;
    let lastKnown = false;
    let overflow = false;
    let hasNewEvents = false;
    let position: UserHistoryReadingPosition | null = null;
    let notice: UserHistorySessionState['notice'] = null;
    let pages = new Map<string, UserHistoryItem>();
    let retainedPages: Map<string, UserHistoryItem> | undefined;
    let overlay = new Map<string, UserHistoryItem>();
    let epoch = 0;
    let controller: AbortController | undefined;
    let operation: Promise<void> | undefined;
    let failedCursor: string | null = null;
    let failedRebuild = false;
    const listeners = new Set<() => void>();
    let state = snapshot();

    return {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        acceptRealtime(update) {
            if (status === 'closed') {
                return;
            }

            if (update.kind === 'interrupted') {
                cancel();
                retain();
                hasBaseline = false;
                status = 'waiting_for_baseline';
                emit();

                return;
            }

            const incomingGeneration =
                update.storage.historyGenerationId ??
                (update.kind === 'baseline' ? (update.lastKnownHistoryGenerationId ?? null) : null);
            const changed =
                incomingGeneration !== null &&
                generation !== null &&
                incomingGeneration !== generation;

            if (changed) {
                cancel();
                pages.clear();
                retainedPages = undefined;
                overlay.clear();
                resetPin();
                position = null;
                overflow = false;
                hasNewEvents = false;
                lastKnown = false;
                notice = 'generation_changed';
            }

            if (incomingGeneration !== null) {
                generation = incomingGeneration;
            }

            const wasUnavailable = error === 'history_unavailable';
            mergeOverlay(update.userHistory ?? [], update.kind === 'addition');

            if (update.kind === 'baseline') {
                hasBaseline = true;

                if (opened) {
                    void rebuild();
                } else {
                    status = 'idle';
                    error = null;
                    emit();
                }

                return;
            }

            if (changed) {
                hasBaseline = true;

                if (opened) {
                    void rebuild();
                }
            } else if (wasUnavailable && update.storage.status === 'available' && hasBaseline) {
                void rebuild();
            } else {
                emit();
            }
        },
        loadNextPage() {
            if (operation) {
                return operation;
            }

            if (
                !hasBaseline ||
                status === 'closed' ||
                status === 'error' ||
                (hasPage && nextCursor === null)
            ) {
                return Promise.resolve();
            }

            opened = true;

            return run(nextCursor, false);
        },
        retry() {
            if (operation || status !== 'error' || !hasBaseline) {
                return operation ?? Promise.resolve();
            }

            if (error === 'cursor_query_mismatch' || error === 'recovery_limit') {
                return rebuild();
            }

            return run(failedCursor, failedRebuild);
        },
        refreshToNewest() {
            if (status === 'closed') {
                return Promise.resolve();
            }

            position = null;
            hasNewEvents = false;
            notice = null;

            if (overflow && hasBaseline) {
                return rebuild();
            }

            emit();

            return Promise.resolve();
        },
        updateReadingPosition(next) {
            if (status === 'closed') {
                return;
            }

            const changedMode = (position === null) !== (next === null);
            position = next;

            if (changedMode) {
                emit();
            }
        },
        close() {
            if (status === 'closed') {
                return;
            }

            cancel();
            status = 'closed';
            pages.clear();
            overlay.clear();
            retainedPages = undefined;
            resetPin();
            position = null;
            lastKnown = false;
            hasNewEvents = false;
            hasBaseline = false;
            overflow = false;
            emit();
            listeners.clear();
        },
    };

    function resetPin() {
        hasPage = false;
        acceptedPages = 0;
        throughSequence = null;
        retentionAsOf = null;
        nextCursor = null;
        pageCursors.clear();
    }

    function cancel() {
        epoch += 1;
        controller?.abort();
        controller = undefined;
        operation = undefined;
    }

    function retain() {
        if (!retainedPages) {
            retainedPages = pages;
        }

        lastKnown = true;
    }

    function rebuild(): Promise<void> {
        cancel();
        retain();
        pages = new Map();
        resetPin();
        overflow = false;

        return run(null, true);
    }

    function run(cursor: string | null, rebuilding: boolean): Promise<void> {
        status = 'loading';
        error = null;
        const currentEpoch = ++epoch;
        controller = new AbortController();
        const signal = controller.signal;
        // Publish loading before fetching; subscribers cannot start another operation.
        operation = Promise.resolve();
        emit();
        const pending = readPages(cursor, rebuilding, currentEpoch, signal).finally(() => {
            if (currentEpoch === epoch) {
                operation = undefined;
                controller = undefined;
            }
        });
        operation = pending;

        return pending;
    }

    async function readPages(
        initialCursor: string | null,
        rebuilding: boolean,
        currentEpoch: number,
        signal: AbortSignal,
    ) {
        let cursor = initialCursor;
        let restarted = false;
        let pageCount = 0;

        try {
            while (active(currentEpoch)) {
                if (
                    ++pageCount > userHistoryLimits.pages ||
                    acceptedPages >= userHistoryLimits.pages
                ) {
                    fail('recovery_limit', cursor, rebuilding);

                    return;
                }

                const url = new URL(
                    '/room/history/user-history',
                    (import.meta.env.VITE_BFF_URL ?? 'http://localhost:4310').replace(/\/+$/u, ''),
                );
                url.searchParams.set('pageSize', String(userHistoryLimits.pageSize));

                if (cursor !== null) {
                    url.searchParams.set('cursor', cursor);
                }

                const response = await fetchImplementation(url.toString(), { signal });

                if (!active(currentEpoch)) {
                    return;
                }

                let body: unknown;

                try {
                    body = await response.json();
                } catch {
                    if (active(currentEpoch)) {
                        fail('invalid_response', cursor, rebuilding);
                    }

                    return;
                }

                if (!active(currentEpoch)) {
                    return;
                }

                const result = validateUserHistoryResponse(response.status, body);

                if (result.kind === 'unavailable') {
                    fail('history_unavailable', cursor, rebuilding);

                    return;
                }

                if (result.kind === 'invalid_response') {
                    fail('invalid_response', cursor, rebuilding);

                    return;
                }

                if (result.kind === 'cursor_error') {
                    if (result.error.error === 'history_generation_changed') {
                        awaitBaseline();

                        return;
                    }

                    if (result.error.error === 'cursor_query_mismatch') {
                        fail('cursor_query_mismatch', cursor, rebuilding);

                        return;
                    }

                    if (cursor === null || restarted) {
                        fail('invalid_response', cursor, rebuilding);

                        return;
                    }

                    restarted = true;
                    rebuilding = true;
                    retain();
                    pages = new Map();
                    resetPin();
                    cursor = null;
                    emit();
                    continue;
                }

                const page = result.page;

                if (generation !== null && page.historyGenerationId !== generation) {
                    awaitBaseline();

                    return;
                }

                if (
                    !matching(page) ||
                    (page.nextCursor !== null &&
                        (page.nextCursor === cursor || pageCursors.has(page.nextCursor)))
                ) {
                    fail('invalid_response', cursor, rebuilding);

                    return;
                }

                if (cursor !== null) {
                    pageCursors.add(cursor);
                }

                const additions = page.items.filter((item) => !pages.has(item.recordId));

                if (pages.size + additions.length > userHistoryLimits.items) {
                    fail('recovery_limit', cursor, rebuilding);

                    return;
                }

                generation = page.historyGenerationId;
                throughSequence = page.throughSequence;
                retentionAsOf = page.retentionAsOf;
                hasPage = true;
                acceptedPages += 1;
                nextCursor = page.nextCursor;

                for (const item of page.items) {
                    pages.set(item.recordId, item);
                }

                if (
                    rebuilding &&
                    position !== null &&
                    !pages.has(position.recordId) &&
                    !overlay.has(position.recordId) &&
                    nextCursor !== null
                ) {
                    cursor = nextCursor;
                    continue;
                }

                if (
                    rebuilding &&
                    position !== null &&
                    !pages.has(position.recordId) &&
                    !overlay.has(position.recordId)
                ) {
                    const available = merge(pages, overlay);
                    const oldPosition = position;
                    const nearest =
                        available.find(
                            (item) => compareUserHistoryDescending(item, oldPosition) >= 0,
                        ) ?? available.at(-1);
                    position = nearest
                        ? {
                              recordId: nearest.recordId,
                              occurredAt: nearest.occurredAt,
                              offsetPx: oldPosition.offsetPx,
                          }
                        : null;
                    notice = 'anchor_unavailable';
                }

                retainedPages = undefined;
                lastKnown = false;
                error = null;
                status = 'ready';
                emit();

                return;
            }
        } catch {
            if (active(currentEpoch)) {
                fail('request_failed', cursor, rebuilding);
            }
        }
    }

    function awaitBaseline() {
        retain();
        cancel();
        resetPin();
        hasBaseline = false;
        status = 'waiting_for_baseline';
        emit();
        requestBaseline();
    }

    function matching(page: UserHistoryPage) {
        return (
            page.pageSize === userHistoryLimits.pageSize &&
            (!hasPage ||
                (page.throughSequence === throughSequence &&
                    page.retentionAsOf === retentionAsOf &&
                    page.historyGenerationId === generation))
        );
    }

    function fail(reason: HistoryError, cursor: string | null, rebuilding: boolean) {
        error = reason;
        status = 'error';
        lastKnown = true;
        failedCursor = cursor;
        failedRebuild = rebuilding;
        emit();
    }

    function active(currentEpoch: number) {
        return currentEpoch === epoch && status !== 'closed';
    }

    function mergeOverlay(additions: readonly UserHistoryItem[], live: boolean) {
        for (const item of additions) {
            const previous = overlay.get(item.recordId);

            if (
                live &&
                position !== null &&
                !previous &&
                !pages.has(item.recordId) &&
                !retainedPages?.has(item.recordId)
            ) {
                hasNewEvents = true;
            }

            if (!previous || previous.durability !== 'durable' || item.durability === 'durable') {
                overlay.set(item.recordId, item);
            }
        }

        if (overlay.size > userHistoryLimits.overlay) {
            overflow = true;
            const sorted = [...overlay.values()].sort(compareUserHistoryDescending);
            const anchored = position ? overlay.get(position.recordId) : undefined;
            const kept = sorted
                .filter((item) => item.recordId !== anchored?.recordId)
                .slice(0, userHistoryLimits.overlay - (anchored ? 1 : 0));

            if (anchored) {
                kept.push(anchored);
            }

            overlay = new Map(kept.map((item) => [item.recordId, item]));
        }
    }

    function snapshot(): UserHistorySessionState {
        return {
            status,
            items: merge(retainedPages ?? pages, overlay),
            historyGenerationId: generation,
            throughSequence,
            retentionAsOf,
            nextCursor,
            endReached: status === 'ready' && hasPage && nextCursor === null,
            lastKnown,
            overlayOverflow: overflow,
            hasNewEvents,
            position,
            notice,
            error,
        };
    }

    function emit() {
        state = snapshot();

        for (const listener of [...listeners]) {
            listener();
        }
    }
}

function merge(
    pages: ReadonlyMap<string, UserHistoryItem>,
    overlay: ReadonlyMap<string, UserHistoryItem>,
): UserHistoryItem[] {
    const result = new Map(pages);

    for (const [id, item] of overlay) {
        const previous = result.get(id);

        if (!previous || previous.durability !== 'durable' || item.durability === 'durable') {
            result.set(id, item);
        }
    }

    return [...result.values()].sort(compareUserHistoryDescending);
}
