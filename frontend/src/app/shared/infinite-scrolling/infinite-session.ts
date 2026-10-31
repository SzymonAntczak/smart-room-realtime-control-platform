export interface InfiniteSource<T, M, E> {
    readPage(request: {
        cursor: string | null;
        signal: AbortSignal;
        items: readonly T[];
        metadata: M | null;
    }): Promise<
        | { kind: 'page'; items: readonly T[]; nextCursor: string | null; metadata: M }
        | { kind: 'error'; error: E; recovery: 'retry' | 'refresh' }
    >;
}

export interface InfiniteState<T, M, E> {
    status: 'idle' | 'loading' | 'ready' | 'error' | 'closed';
    items: readonly T[];
    metadata: M | null;
    nextCursor: string | null;
    endReached: boolean;
    limitReached: boolean;
    lastKnown: boolean;
    refreshRequired: boolean;
    error: E | null;
    sessionRevision: number;
}

/** A bounded cursor reader; sources own protocol validation and recovery policy. */
export function createInfiniteSession<T, M, E>(options: {
    getItemKey(item: T): string;
    maxItems: number;
    maxPages: number;
    duplicates: 'ignore' | 'reject';
    errors: { invalidResponse: E; requestFailed: E; limit: E };
}) {
    let status: InfiniteState<T, M, E>['status'] = 'idle';
    let items: readonly T[] = [];
    let keys = new Set<string>();
    let metadata: M | null = null;
    let previous: { items: readonly T[]; metadata: M | null } | null = null;
    let nextCursor: string | null = null;
    let pages = 0;
    let limitReached = false;
    let error: E | null = null;
    let refreshRequired = false;
    let revision = 0;
    let epoch = 0;
    let controller: AbortController | undefined;
    let operation: Promise<void> | undefined;
    let failedCursor: string | null = null;
    let factory: (() => InfiniteSource<T, M, E>) | null = null;
    let source: InfiniteSource<T, M, E> | null = null;
    const cursors = new Set<string>();
    const listeners = new Set<() => void>();
    let state = snapshot();

    const session = {
        getState: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        start(createSource: () => InfiniteSource<T, M, E>): Promise<void> {
            if (status === 'closed') {
                return Promise.resolve();
            }

            const retained =
                state.metadata !== null ? { items: state.items, metadata: state.metadata } : null;
            reset();
            previous = retained;
            factory = createSource;
            source = createSource();

            return run(null);
        },
        loadMore(): Promise<void> {
            if (operation) {
                return operation;
            }

            if (status !== 'ready' || !source || nextCursor === null || limitReached) {
                return Promise.resolve();
            }

            return run(nextCursor);
        },
        retry(): Promise<void> {
            if (operation) {
                return operation;
            }

            if (status !== 'error' || refreshRequired) {
                return Promise.resolve();
            }

            return run(failedCursor);
        },
        refresh(): Promise<void> {
            return factory && status !== 'closed' ? session.start(factory) : Promise.resolve();
        },
        clear() {
            if (status === 'closed') {
                return;
            }

            reset();
            emit();
        },
        close() {
            reset();
            status = 'closed';
            emit();
            listeners.clear();
        },
    };

    return session;

    function reset() {
        epoch += 1;
        controller?.abort();
        controller = undefined;
        operation = undefined;
        status = 'idle';
        items = [];
        keys = new Set();
        metadata = null;
        previous = null;
        nextCursor = null;
        pages = 0;
        limitReached = false;
        error = null;
        refreshRequired = false;
        failedCursor = null;
        factory = null;
        source = null;
        cursors.clear();
        revision += 1;
    }

    function run(cursor: string | null): Promise<void> {
        const reader = source;

        if (!reader) {
            return Promise.resolve();
        }

        status = 'loading';
        error = null;
        const currentEpoch = ++epoch;
        controller = new AbortController();
        const signal = controller.signal;
        // Reserve the operation before notifying reentrant subscribers.
        operation = Promise.resolve();
        emit();
        const pending = (epoch === currentEpoch ? read() : Promise.resolve()).finally(() => {
            if (epoch === currentEpoch) {
                operation = undefined;
                controller = undefined;
            }
        });

        if (epoch === currentEpoch) {
            operation = pending;
        }

        return pending;

        async function read() {
            try {
                const result = await reader?.readPage({ cursor, signal, items, metadata });

                if (epoch !== currentEpoch || !result) {
                    return;
                }

                if (result.kind === 'error') {
                    fail(result.error, result.recovery === 'refresh');

                    return;
                }

                if (
                    result.nextCursor !== null &&
                    (result.nextCursor === cursor || cursors.has(result.nextCursor))
                ) {
                    fail(options.errors.invalidResponse, false);

                    return;
                }

                const additions: T[] = [];
                const addedKeys = new Set<string>();

                for (const item of result.items) {
                    const key = options.getItemKey(item);

                    if (keys.has(key) || addedKeys.has(key)) {
                        if (options.duplicates === 'reject') {
                            fail(options.errors.invalidResponse, false);

                            return;
                        }
                    } else {
                        additions.push(item);
                        addedKeys.add(key);
                    }
                }

                if (items.length + additions.length > options.maxItems) {
                    fail(options.errors.limit, false);

                    return;
                }

                if (cursor !== null) {
                    cursors.add(cursor);
                }

                items = [...items, ...additions];

                for (const key of addedKeys) {
                    keys.add(key);
                }

                metadata = result.metadata;
                previous = null;
                nextCursor = result.nextCursor;
                pages += 1;
                limitReached =
                    nextCursor !== null &&
                    (items.length >= options.maxItems || pages >= options.maxPages);
                refreshRequired = false;
                status = 'ready';
                emit();
            } catch {
                if (epoch === currentEpoch) {
                    fail(options.errors.requestFailed, false);
                }
            }
        }

        function fail(reason: E, refresh: boolean) {
            status = 'error';
            error = reason;
            failedCursor = cursor;
            refreshRequired = refresh;
            emit();
        }
    }

    function snapshot(): InfiniteState<T, M, E> {
        return {
            status,
            items: previous?.items ?? items,
            metadata: previous?.metadata ?? metadata,
            nextCursor,
            endReached: status === 'ready' && nextCursor === null,
            limitReached,
            lastKnown: previous !== null || (status === 'error' && items.length > 0),
            refreshRequired,
            error,
            sessionRevision: revision,
        };
    }

    function emit() {
        state = snapshot();

        for (const listener of [...listeners]) {
            listener();
        }
    }
}
