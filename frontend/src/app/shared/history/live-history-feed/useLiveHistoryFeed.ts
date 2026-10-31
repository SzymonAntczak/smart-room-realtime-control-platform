import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

import type { useLiveHistory } from '../useLiveHistory';

export function useLiveHistoryFeed(history: ReturnType<typeof useLiveHistory>) {
    const scrollRoot = useRef<HTMLDivElement | null>(null);
    const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);
    const [returningToTop, setReturningToTop] = useState(false);
    const attachScrollRoot = useCallback((element: HTMLDivElement | null) => {
        scrollRoot.current = element;
        setScrollParent(element);
    }, []);

    useEffect(() => {
        if (!returningToTop) {
            return;
        }

        const root = scrollRoot.current;

        if (!root) {
            setReturningToTop(false);

            return;
        }

        const finish = () => setReturningToTop(false);

        const onScroll = () => {
            if (root.scrollTop <= 1) {
                finish();
            }
        };

        root.addEventListener('scroll', onScroll, { passive: true });
        root.addEventListener('scrollend', onScroll);
        root.addEventListener('wheel', finish, { passive: true });
        root.addEventListener('pointerdown', finish);
        root.addEventListener('keydown', finish);

        return () => {
            root.removeEventListener('scroll', onScroll);
            root.removeEventListener('scrollend', onScroll);
            root.removeEventListener('wheel', finish);
            root.removeEventListener('pointerdown', finish);
            root.removeEventListener('keydown', finish);
        };
    }, [returningToTop]);

    function handleHistoryKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const root = scrollRoot.current;

        if (!root || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }

        if (event.key === 'End') {
            event.preventDefault();
            root.scrollTo({ top: root.scrollHeight, behavior: 'auto' });
        } else if (event.key === 'Home') {
            event.preventDefault();
            root.scrollTo({ top: 0, behavior: 'auto' });
            history.showNewest();
        }
    }

    function handleReturnToTop() {
        const root = scrollRoot.current;

        if (root && root.scrollTop <= 1) {
            return { alreadyAtTop: true };
        }

        setReturningToTop(true);
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        root?.scrollTo?.({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        history.showNewest();

        return { alreadyAtTop: false };
    }

    return {
        scrollRoot,
        scrollParent,
        returningToTop,
        attachScrollRoot,
        handleHistoryKeyDown,
        handleReturnToTop,
    };
}
