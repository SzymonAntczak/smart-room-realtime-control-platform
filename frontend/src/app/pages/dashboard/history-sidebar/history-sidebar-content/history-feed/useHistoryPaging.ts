import { useEffect, useRef } from 'react';

import type { HistorySessionState } from '../history-session';

const historyPagingOffset = 320;
const historyScrollKeys = new Set([
    'ArrowDown',
    'ArrowUp',
    'End',
    'Home',
    'PageDown',
    'PageUp',
    ' ',
]);

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
    const userScrollIntentUntil = useRef(0);
    const pointerIsDown = useRef(false);
    const requestPending = useRef(false);

    useEffect(() => {
        userScrollIntentUntil.current = 0;

        if (state.status !== 'loading') {
            requestPending.current = false;
        }
    }, [returningToTop, state.nextCursor, state.status]);

    useEffect(() => {
        if (!scrollViewport) {
            return;
        }

        const view = scrollViewport.ownerDocument.defaultView;
        let boundaryFrame: number | undefined;

        const canLoadOlder = () =>
            !requestPending.current &&
            !returningToTop &&
            state.status === 'ready' &&
            !state.endReached &&
            !state.error &&
            state.nextCursor !== null;

        const handleScroll = () => {
            if (
                !canLoadOlder() ||
                userScrollIntentUntil.current === 0 ||
                Date.now() > userScrollIntentUntil.current
            ) {
                return;
            }

            const distanceToEnd =
                scrollViewport.scrollHeight -
                scrollViewport.clientHeight -
                scrollViewport.scrollTop;

            if (distanceToEnd <= historyPagingOffset) {
                // Consume this approach before React publishes loading or measures the new page.
                requestPending.current = true;
                userScrollIntentUntil.current = 0;
                loadOlder();
            }
        };

        const markScrollIntent = () => {
            if (canLoadOlder()) {
                userScrollIntentUntil.current = Date.now() + 500;
            }
        };

        const checkBoundaryAfterInput = () => {
            if (boundaryFrame !== undefined || !view) {
                return;
            }

            // Let the input finish scrolling before adding a loading indicator to the viewport.
            boundaryFrame = view.requestAnimationFrame(() => {
                boundaryFrame = undefined;
                handleScroll();
            });
        };

        const handleWheel = (event: WheelEvent) => {
            markScrollIntent();

            if (event.deltaY > 0) {
                checkBoundaryAfterInput();
            }
        };

        const handleTouchMove = () => {
            markScrollIntent();

            checkBoundaryAfterInput();
        };

        const handlePointerDown = () => {
            pointerIsDown.current = true;
            markScrollIntent();
        };

        const handlePointerMove = () => {
            if (pointerIsDown.current) {
                markScrollIntent();
            }
        };

        const handlePointerUp = () => {
            if (!pointerIsDown.current) {
                return;
            }

            pointerIsDown.current = false;
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            const isInteractiveTarget =
                target instanceof HTMLElement &&
                target.closest('button, input, select, textarea, [contenteditable="true"]');

            if (!isInteractiveTarget && historyScrollKeys.has(event.key)) {
                markScrollIntent();

                if (['ArrowDown', 'End', 'PageDown', ' '].includes(event.key)) {
                    checkBoundaryAfterInput();
                }
            }
        };

        scrollViewport.addEventListener('scroll', handleScroll, { passive: true });
        scrollViewport.addEventListener('wheel', handleWheel, { passive: true });
        scrollViewport.addEventListener('touchmove', handleTouchMove, { passive: true });
        scrollViewport.addEventListener('keydown', handleKeyDown);
        scrollViewport.addEventListener('pointerdown', handlePointerDown);
        scrollViewport.addEventListener('pointermove', handlePointerMove);
        view?.addEventListener('pointerup', handlePointerUp);
        view?.addEventListener('pointercancel', handlePointerUp);

        return () => {
            if (boundaryFrame !== undefined) {
                view?.cancelAnimationFrame(boundaryFrame);
            }

            scrollViewport.removeEventListener('scroll', handleScroll);
            scrollViewport.removeEventListener('wheel', handleWheel);
            scrollViewport.removeEventListener('touchmove', handleTouchMove);
            scrollViewport.removeEventListener('keydown', handleKeyDown);
            scrollViewport.removeEventListener('pointerdown', handlePointerDown);
            scrollViewport.removeEventListener('pointermove', handlePointerMove);
            view?.removeEventListener('pointerup', handlePointerUp);
            view?.removeEventListener('pointercancel', handlePointerUp);
        };
    }, [
        loadOlder,
        returningToTop,
        scrollViewport,
        state.endReached,
        state.error,
        state.nextCursor,
        state.status,
    ]);
}
