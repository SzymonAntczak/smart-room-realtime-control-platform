import {
    defaultUserHistoryPageSize,
    normalizeUserHistoryPageQuery,
    type UserHistoryFirstPageQuery,
    type UserHistoryItem,
    type UserHistoryPage,
} from '@smart-room/contracts/user-history';

import { createHistoryClient, type HistoryClient } from '../../api/history';
import { createInfiniteSession, type InfiniteSource } from '../infinite-scrolling';

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

interface HistorySearchSession {
    getState(): HistorySearchState;
    subscribe(listener: () => void): () => void;
    search(criteria: HistorySearchCriteria): Promise<boolean>;
    loadOlder(): Promise<void>;
    retry(): Promise<void>;
    refresh(): Promise<void>;
    clear(): void;
    close(): void;
}

interface Metadata {
    criteria: HistorySearchCriteria;
    pin: Pick<
        UserHistoryPage,
        'historyGenerationId' | 'throughSequence' | 'retentionAsOf' | 'completeness'
    >;
}

/** Domain adapter around the shared static cursor session. */
export function createHistorySearchSession(
    client: HistoryClient = createHistoryClient(),
): HistorySearchSession {
    let appliedCriteria: HistorySearchCriteria | null = null;
    const core = createInfiniteSession<UserHistoryItem, Metadata, HistorySearchError>({
        getItemKey: (item) => item.recordId,
        maxItems: limits.items,
        maxPages: limits.pages,
        duplicates: 'ignore',
        errors: {
            invalidResponse: 'invalid_response',
            requestFailed: 'request_failed',
            limit: 'history_limit_reached',
        },
    });
    let state = snapshot();
    const listeners = new Set<() => void>();
    core.subscribe(() => {
        state = snapshot();

        for (const listener of [...listeners]) {
            listener();
        }
    });

    return {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        search(criteria) {
            if (core.getState().status === 'closed') {
                return Promise.resolve(false);
            }

            const normalized = normalizeCriteria(criteria);

            if (!normalized) {
                return Promise.resolve(false);
            }

            appliedCriteria = normalized;

            return core
                .start(
                    (): InfiniteSource<UserHistoryItem, Metadata, HistorySearchError> => ({
                        async readPage({ cursor, signal, metadata }) {
                            const result = await client.readPage(
                                { ...normalized, pageSize: limits.pageSize, cursor },
                                signal,
                            );

                            if (result.kind === 'unavailable') {
                                return {
                                    kind: 'error',
                                    error: 'history_unavailable',
                                    recovery: 'retry',
                                };
                            }

                            if (result.kind === 'invalid_response') {
                                return {
                                    kind: 'error',
                                    error: 'invalid_response',
                                    recovery: 'retry',
                                };
                            }

                            if (result.kind === 'cursor_error') {
                                return {
                                    kind: 'error',
                                    error: result.error.error,
                                    recovery: 'refresh',
                                };
                            }

                            const page = result.page;
                            const pin = metadata?.pin;

                            if (
                                page.pageSize !== limits.pageSize ||
                                (pin &&
                                    (page.historyGenerationId !== pin.historyGenerationId ||
                                        page.throughSequence !== pin.throughSequence ||
                                        page.retentionAsOf !== pin.retentionAsOf ||
                                        page.completeness !== pin.completeness))
                            ) {
                                return {
                                    kind: 'error',
                                    error: 'invalid_response',
                                    recovery: 'refresh',
                                };
                            }

                            return {
                                kind: 'page',
                                items: page.items,
                                nextCursor: page.nextCursor,
                                metadata: {
                                    criteria: normalized,
                                    pin: {
                                        historyGenerationId: page.historyGenerationId,
                                        throughSequence: page.throughSequence,
                                        retentionAsOf: page.retentionAsOf,
                                        completeness: page.completeness,
                                    },
                                },
                            };
                        },
                    }),
                )
                .then(() => true);
        },
        loadOlder: core.loadMore,
        retry: core.retry,
        refresh: core.refresh,
        clear() {
            appliedCriteria = null;
            core.clear();
        },
        close() {
            appliedCriteria = null;
            core.close();
            listeners.clear();
        },
    };

    function snapshot(): HistorySearchState {
        const current = core.getState();

        return {
            ...current,
            appliedCriteria,
            displayedCriteria: current.metadata?.criteria ?? null,
            historyGenerationId: current.metadata?.pin.historyGenerationId ?? null,
            throughSequence: current.metadata?.pin.throughSequence ?? null,
            retentionAsOf: current.metadata?.pin.retentionAsOf ?? null,
            completeness: current.metadata?.pin.completeness ?? null,
        };
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
