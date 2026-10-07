import {
    defaultUserHistoryPageSize,
    normalizeUserHistoryPageQuery,
    type UserHistoryFirstPageQuery,
    type UserHistoryItem,
    type UserHistoryPage,
} from '@smart-room/contracts/user-history';

import { createHistoryClient, type HistoryClient } from '../../../../api/history';

const limits = { pageSize: defaultUserHistoryPageSize, pages: 100, items: 5000 } as const;

export type HistorySearchCriteria = Pick<UserHistoryFirstPageQuery, 'deviceId' | 'from' | 'to'>;
type HistorySearchError =
    | 'history_unavailable'
    | 'invalid_response'
    | 'request_failed'
    | 'history_generation_changed'
    | 'cursor_expired'
    | 'invalid_cursor'
    | 'cursor_query_mismatch'
    | 'history_limit_reached';

interface HistorySearchState {
    status: 'idle' | 'loading' | 'ready' | 'error' | 'closed';
    items: readonly UserHistoryItem[];
    appliedCriteria: HistorySearchCriteria | null;
    displayedCriteria: HistorySearchCriteria | null;
    historyGenerationId: string | null;
    throughSequence: number | null;
    retentionAsOf: string | null;
    completeness: UserHistoryPage['completeness'] | null;
    nextCursor: string | null;
    endReached: boolean;
    lastKnown: boolean;
    refreshRequired: boolean;
    limitReached: boolean;
    error: HistorySearchError | null;
    sessionRevision: number;
}

export interface HistorySearchSession {
    getState(): HistorySearchState;
    subscribe(listener: () => void): () => void;
    search(criteria: HistorySearchCriteria): Promise<boolean>;
    loadOlder(): Promise<void>;
    retry(): Promise<void>;
    refresh(): Promise<void>;
    clear(): void;
    close(): void;
}

interface PinnedView {
    historyGenerationId: string;
    throughSequence: number;
    retentionAsOf: string;
    completeness: UserHistoryPage['completeness'];
}

interface LastKnownView {
    items: readonly UserHistoryItem[];
    criteria: HistorySearchCriteria;
    pin: PinnedView | null;
}

/** A bounded static HTTP search. It has no connection to the Dashboard SSE source. */
export function createHistorySearchSession(
    client: HistoryClient = createHistoryClient(),
): HistorySearchSession {
    let status: HistorySearchState['status'] = 'idle';
    let activeCriteria: HistorySearchCriteria | null = null;
    let displayedCriteria: HistorySearchCriteria | null = null;
    let pin: PinnedView | null = null;
    let nextCursor: string | null = null;
    let acceptedPages = 0;
    let items = new Map<string, UserHistoryItem>();
    let lastKnown: LastKnownView | null = null;
    let refreshRequired = false;
    let limitReached = false;
    let error: HistorySearchError | null = null;
    let sessionRevision = 0;
    let epoch = 0;
    let controller: AbortController | undefined;
    let operation: Promise<void> | undefined;
    let failedCursor: string | null = null;
    const seenCursors = new Set<string>();
    const listeners = new Set<() => void>();
    let state = snapshot();

    return {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);

            return () => listeners.delete(listener);
        },
        search(criteria) {
            if (status === 'closed') {
                return Promise.resolve(false);
            }

            const normalized = normalizeCriteria(criteria);

            if (normalized === undefined) {
                return Promise.resolve(false);
            }

            const hadSearch = activeCriteria !== null;
            replaceWith(normalized, hadSearch);

            return run(null).then(() => true);
        },
        loadOlder() {
            if (
                operation ||
                status === 'closed' ||
                status === 'error' ||
                activeCriteria === null ||
                nextCursor === null ||
                limitReached
            ) {
                return operation ?? Promise.resolve();
            }

            return run(nextCursor);
        },
        retry() {
            if (operation || status !== 'error' || refreshRequired || activeCriteria === null) {
                return operation ?? Promise.resolve();
            }

            return run(failedCursor);
        },
        refresh() {
            if (status === 'closed' || activeCriteria === null) {
                return Promise.resolve();
            }

            const criteria = activeCriteria;
            replaceWith(criteria, true);

            return run(null);
        },
        clear() {
            if (status === 'closed') {
                return;
            }

            cancel();
            status = 'idle';
            activeCriteria = null;
            displayedCriteria = null;
            pin = null;
            nextCursor = null;
            acceptedPages = 0;
            items.clear();
            lastKnown = null;
            refreshRequired = false;
            limitReached = false;
            error = null;
            failedCursor = null;
            seenCursors.clear();
            sessionRevision += 1;
            emit();
        },
        close() {
            if (status === 'closed') {
                return;
            }

            cancel();
            status = 'closed';
            activeCriteria = null;
            displayedCriteria = null;
            pin = null;
            nextCursor = null;
            acceptedPages = 0;
            items.clear();
            lastKnown = null;
            refreshRequired = false;
            limitReached = false;
            error = null;
            failedCursor = null;
            seenCursors.clear();
            sessionRevision += 1;
            emit();
            listeners.clear();
        },
    };

    function replaceWith(criteria: HistorySearchCriteria, retainCurrent: boolean) {
        cancel();

        if (retainCurrent && displayedCriteria !== null && visibleItems().length > 0) {
            lastKnown = {
                items: visibleItems(),
                criteria: displayedCriteria,
                pin: pin ?? lastKnown?.pin ?? null,
            };
        } else if (!retainCurrent) {
            lastKnown = null;
        }

        activeCriteria = criteria;
        pin = null;
        nextCursor = null;
        acceptedPages = 0;
        items = new Map();
        refreshRequired = false;
        limitReached = false;
        error = null;
        failedCursor = null;
        seenCursors.clear();
        status = 'idle';
        sessionRevision += 1;
    }

    function run(cursor: string | null): Promise<void> {
        if (activeCriteria === null || status === 'closed') {
            return Promise.resolve();
        }

        status = 'loading';
        error = null;
        const currentEpoch = ++epoch;
        const signalController = new AbortController();
        controller = signalController;
        operation = Promise.resolve();
        emit();

        const pending = readPages(cursor, currentEpoch, signalController.signal).finally(() => {
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
        currentEpoch: number,
        signal: AbortSignal,
    ) {
        let cursor = initialCursor;

        try {
            while (active(currentEpoch)) {
                const criteria = activeCriteria;

                if (criteria === null) {
                    return;
                }

                if (acceptedPages >= limits.pages || items.size >= limits.items) {
                    limitReached = cursor !== null;
                    status = 'ready';
                    error = null;
                    emit();

                    return;
                }

                const result = await client.readPage(
                    { ...criteria, pageSize: limits.pageSize, cursor },
                    signal,
                );

                if (!active(currentEpoch)) {
                    return;
                }

                if (result.kind === 'unavailable') {
                    fail('history_unavailable', cursor, false);

                    return;
                }

                if (result.kind === 'invalid_response') {
                    fail('invalid_response', cursor, false);

                    return;
                }

                if (result.kind === 'cursor_error') {
                    const reason = result.error.error;
                    fail(reason, cursor, true);

                    return;
                }

                if (!matchesPin(result.page)) {
                    fail('invalid_response', cursor, true);

                    return;
                }

                if (hasCursorCycle(result.page.nextCursor, cursor)) {
                    fail('invalid_response', cursor, false);

                    return;
                }

                const page = result.page;
                const additions = page.items.filter((item) => !items.has(item.recordId));

                if (items.size + additions.length > limits.items) {
                    fail('history_limit_reached', cursor, false);

                    return;
                }

                if (pin === null) {
                    pin = {
                        historyGenerationId: page.historyGenerationId,
                        throughSequence: page.throughSequence,
                        retentionAsOf: page.retentionAsOf,
                        completeness: page.completeness,
                    };
                }

                if (cursor !== null) {
                    seenCursors.add(cursor);
                }

                for (const item of additions) {
                    items.set(item.recordId, item);
                }

                acceptedPages += 1;
                nextCursor = page.nextCursor;
                const replacedLastKnown = lastKnown !== null;
                displayedCriteria = criteria;
                lastKnown = null;

                if (
                    nextCursor !== null &&
                    (items.size >= limits.items || acceptedPages >= limits.pages)
                ) {
                    limitReached = true;
                }

                if (
                    replacedLastKnown &&
                    additions.length === 0 &&
                    nextCursor !== null &&
                    !limitReached
                ) {
                    emit();
                }

                if (additions.length > 0 || nextCursor === null || limitReached) {
                    status = 'ready';
                    error = null;
                    emit();

                    return;
                }

                cursor = nextCursor;
            }
        } catch {
            if (active(currentEpoch)) {
                fail('request_failed', cursor, false);
            }
        }
    }

    function matchesPin(page: UserHistoryPage): boolean {
        return (
            page.pageSize === limits.pageSize &&
            (pin === null ||
                (page.historyGenerationId === pin.historyGenerationId &&
                    page.throughSequence === pin.throughSequence &&
                    page.retentionAsOf === pin.retentionAsOf &&
                    page.completeness === pin.completeness))
        );
    }

    function hasCursorCycle(next: string | null, current: string | null): boolean {
        return next !== null && (next === current || seenCursors.has(next));
    }

    function fail(reason: HistorySearchError, cursor: string | null, requiresRefresh: boolean) {
        error = reason;
        failedCursor = cursor;
        refreshRequired = requiresRefresh;
        status = 'error';
        emit();
    }

    function cancel() {
        epoch += 1;
        controller?.abort();
        controller = undefined;
        operation = undefined;
    }

    function active(currentEpoch: number): boolean {
        return currentEpoch === epoch && status !== 'closed';
    }

    function visibleItems(): readonly UserHistoryItem[] {
        return lastKnown?.items ?? [...items.values()];
    }

    function snapshot(): HistorySearchState {
        const retained = lastKnown;

        return {
            status,
            items: visibleItems(),
            appliedCriteria: activeCriteria,
            displayedCriteria: retained?.criteria ?? displayedCriteria,
            historyGenerationId:
                retained?.pin?.historyGenerationId ?? pin?.historyGenerationId ?? null,
            throughSequence: retained?.pin?.throughSequence ?? pin?.throughSequence ?? null,
            retentionAsOf: retained?.pin?.retentionAsOf ?? pin?.retentionAsOf ?? null,
            completeness: retained?.pin?.completeness ?? pin?.completeness ?? null,
            nextCursor,
            endReached: status === 'ready' && nextCursor === null,
            lastKnown: retained !== null || (status === 'error' && items.size > 0),
            refreshRequired,
            limitReached,
            error,
            sessionRevision,
        };
    }

    function emit() {
        state = snapshot();

        for (const listener of [...listeners]) {
            listener();
        }
    }
}

function normalizeCriteria(criteria: HistorySearchCriteria): HistorySearchCriteria | undefined {
    const query = normalizeUserHistoryPageQuery({ pageSize: limits.pageSize, ...criteria });

    if (
        query === undefined ||
        (query.deviceId === undefined && query.from === undefined && query.to === undefined)
    ) {
        return undefined;
    }

    return {
        ...(query.deviceId !== undefined ? { deviceId: query.deviceId } : {}),
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
    };
}
