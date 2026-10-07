import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ListRange } from 'react-virtuoso';

import type { HistorySessionState } from '../history-session';

export function useHistoryPaging({
    state,
    scrollViewport,
    loadOlder,
    returningToTop,
}: {
    state: HistorySessionState;
    scrollViewport: HTMLElement | null;
    loadOlder(): void;
    returningToTop: boolean;
}) {
    const [viewportHeight, setViewportHeight] = useState(0);
    const pagingBoundary = useRef({ itemCount: 0, atEnd: false });

    useLayoutEffect(() => {
        if (!scrollViewport) {
            return;
        }

        const updateViewportHeight = () => {
            setViewportHeight(scrollViewport.clientHeight);
        };

        updateViewportHeight();

        const resizeObserver = new ResizeObserver(updateViewportHeight);
        resizeObserver.observe(scrollViewport);

        return () => resizeObserver.disconnect();
    }, [scrollViewport]);

    const endReached = useCallback(
        (index: number) => {
            pagingBoundary.current = { itemCount: index + 1, atEnd: true };

            if (
                !returningToTop &&
                state.status === 'ready' &&
                !state.endReached &&
                !state.error &&
                state.nextCursor !== null
            ) {
                loadOlder();
            }
        },
        [loadOlder, returningToTop, state.endReached, state.error, state.nextCursor, state.status],
    );

    const rangeChanged = useCallback(
        ({ endIndex }: ListRange) => {
            const itemCount = state.items.length;
            pagingBoundary.current = { itemCount, atEnd: endIndex >= itemCount - 1 };
        },
        [state.items.length],
    );

    useEffect(() => {
        if (
            returningToTop ||
            state.status !== 'ready' ||
            state.endReached ||
            state.error ||
            state.nextCursor === null
        ) {
            return;
        }

        const atPagingBoundary =
            pagingBoundary.current.itemCount === state.items.length && pagingBoundary.current.atEnd;

        if (state.items.length === 0 || atPagingBoundary) {
            loadOlder();
        }
    }, [
        loadOlder,
        returningToTop,
        state.endReached,
        state.error,
        state.items.length,
        state.nextCursor,
        state.status,
    ]);

    const increaseViewportBy = useMemo(
        () => ({ top: 0, bottom: viewportHeight }),
        [viewportHeight],
    );

    return {
        endReached,
        increaseViewportBy,
        rangeChanged,
    };
}
