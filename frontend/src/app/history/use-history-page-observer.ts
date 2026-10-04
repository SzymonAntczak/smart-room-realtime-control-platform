import { type RefObject, useEffect } from 'react';

import type { UserHistorySessionState } from './user-history-session';

export function useHistoryPageObserver({
    state,
    scrollRoot,
    anchor,
    loadOlder,
    disabled,
}: {
    state: UserHistorySessionState;
    scrollRoot: RefObject<HTMLElement | null>;
    anchor: RefObject<HTMLElement | null>;
    loadOlder(): void;
    disabled: boolean;
}) {
    useEffect(() => {
        const root = scrollRoot.current;
        const target = anchor.current;

        if (
            !root ||
            !target ||
            disabled ||
            typeof IntersectionObserver === 'undefined' ||
            state.status !== 'ready' ||
            state.endReached ||
            state.error
        ) {
            return;
        }

        let observer: IntersectionObserver | undefined;

        const observe = () => {
            observer?.disconnect();
            observer = new IntersectionObserver(
                (entries) => {
                    if (entries.some((entry) => entry.isIntersecting)) {
                        loadOlder();
                    }
                },
                {
                    root,
                    rootMargin: `0px 0px ${root.clientHeight}px 0px`,
                    threshold: 0,
                },
            );
            observer.observe(target);
        };

        observe();

        const resizeObserver =
            typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(observe);
        resizeObserver?.observe(root);

        return () => {
            observer?.disconnect();
            resizeObserver?.disconnect();
        };
    }, [
        anchor,
        loadOlder,
        scrollRoot,
        state.status,
        disabled,
        state.endReached,
        state.error,
        state.nextCursor,
    ]);
}
