import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';

import type { HistoryReadingPosition, HistorySessionState } from '../history-session';

/** Tracks reading identity and focus; Virtuoso owns row geometry and measurement corrections. */
export function useHistoryVirtualizer({
    state,
    scrollRoot,
    returningToTop,
    updateReadingPosition,
}: {
    state: HistorySessionState;
    scrollRoot: RefObject<HTMLElement | null>;
    returningToTop: boolean;
    updateReadingPosition(position: HistoryReadingPosition | null): void;
}) {
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const position = useRef(state.position);
    const positionIndex = useRef<number | null>(null);
    const stateRef = useRef(state);
    const updatePositionRef = useRef(updateReadingPosition);
    const focused = useRef<HTMLElement | null>(null);
    const restoringPosition = useRef(false);
    const restorationVersion = useRef(0);
    const pinnedPosition = useRef<HistoryReadingPosition | null>(null);
    const previousItems = useRef(state.items);

    useLayoutEffect(() => {
        stateRef.current = state;
        updatePositionRef.current = updateReadingPosition;
    }, [state, updateReadingPosition]);

    useEffect(() => {
        const root = scrollRoot.current;

        if (!root) {
            return;
        }

        const onScroll = () => {
            if (returningToTop || restoringPosition.current) {
                return;
            }

            const list = root.querySelector('ol');

            if (!list) {
                return;
            }

            const rootTop = root.getBoundingClientRect().top;
            const visible = Array.from(list.querySelectorAll<HTMLElement>('[data-index]')).find(
                (element) => element.getBoundingClientRect().bottom > rootTop + 2,
            );

            if (root.scrollTop <= 1) {
                position.current = null;
                positionIndex.current = null;
                updatePositionRef.current(null);

                return;
            }

            const index = visible ? Number(visible.dataset.index) : -1;
            const item = stateRef.current.items[index];

            if (!visible || !item) {
                return;
            }

            const nextPosition = {
                recordId: item.recordId,
                occurredAt: item.occurredAt,
                offsetPx: visible.getBoundingClientRect().top - rootTop,
            };
            position.current = nextPosition;
            positionIndex.current = index;
            updatePositionRef.current(nextPosition);
        };

        const onFocus = (event: FocusEvent) => {
            focused.current = event.target instanceof HTMLElement ? event.target : null;
        };

        const onBlur = (event: FocusEvent) => {
            if (event.relatedTarget instanceof Node && !root.contains(event.relatedTarget)) {
                focused.current = null;
            }
        };

        const onPointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && !root.contains(event.target)) {
                focused.current = null;
            }
        };

        const onScrollIntent = () => {
            restorationVersion.current += 1;
            pinnedPosition.current = null;
            restoringPosition.current = false;
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (
                ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(
                    event.key,
                )
            ) {
                onScrollIntent();
            }
        };

        root.addEventListener('scroll', onScroll, { passive: true });
        root.addEventListener('wheel', onScrollIntent, { passive: true });
        root.addEventListener('touchstart', onScrollIntent, { passive: true });
        root.addEventListener('touchmove', onScrollIntent, { passive: true });
        root.addEventListener('pointerdown', onScrollIntent);
        root.addEventListener('keydown', onKeyDown);
        root.addEventListener('focusin', onFocus);
        root.addEventListener('focusout', onBlur);
        document.addEventListener('pointerdown', onPointerDown, true);

        return () => {
            root.removeEventListener('scroll', onScroll);
            root.removeEventListener('wheel', onScrollIntent);
            root.removeEventListener('touchstart', onScrollIntent);
            root.removeEventListener('touchmove', onScrollIntent);
            root.removeEventListener('pointerdown', onScrollIntent);
            root.removeEventListener('keydown', onKeyDown);
            root.removeEventListener('focusin', onFocus);
            root.removeEventListener('focusout', onBlur);
            document.removeEventListener('pointerdown', onPointerDown, true);
        };
    }, [scrollRoot, returningToTop]);

    useLayoutEffect(() => {
        const nextPosition = state.position;
        const priorItems = previousItems.current;
        const itemsChanged = priorItems !== state.items;
        const anchorIndexChanged =
            nextPosition !== null &&
            priorItems.findIndex((item) => item.recordId === nextPosition.recordId) !==
                state.items.findIndex((item) => item.recordId === nextPosition.recordId);
        previousItems.current = state.items;

        let shouldRestore = false;

        if (returningToTop || nextPosition === null) {
            pinnedPosition.current = null;
            position.current = nextPosition;
        } else if (
            itemsChanged &&
            anchorIndexChanged &&
            pinnedPosition.current === null &&
            state.items.some((item) => item.recordId === nextPosition.recordId)
        ) {
            pinnedPosition.current = nextPosition;
        } else if (
            pinnedPosition.current !== null &&
            !state.items.some((item) => item.recordId === pinnedPosition.current?.recordId) &&
            state.items.some((item) => item.recordId === nextPosition.recordId)
        ) {
            pinnedPosition.current = nextPosition;
        }

        if (pinnedPosition.current !== null) {
            position.current = pinnedPosition.current;
            shouldRestore = true;
        } else if (!samePosition(position.current, nextPosition)) {
            position.current = nextPosition;
            shouldRestore = nextPosition !== null;
        }

        if (pinnedPosition.current !== null) {
            restoringPosition.current = true;
        } else if (nextPosition === null || returningToTop) {
            restoringPosition.current = false;
        }

        if (returningToTop) {
            position.current = null;
            positionIndex.current = null;

            return;
        }

        if (nextPosition === null) {
            positionIndex.current = null;

            return;
        }

        const anchor = position.current;

        if (anchor) {
            const knownIndex = positionIndex.current;
            const index =
                knownIndex !== null && state.items[knownIndex]?.recordId === anchor.recordId
                    ? knownIndex
                    : state.items.findIndex((item) => item.recordId === anchor.recordId);

            if (index >= 0) {
                if (shouldRestore || positionIndex.current !== index) {
                    virtuosoRef.current?.scrollToIndex({
                        index,
                        align: 'start',
                        offset: -anchor.offsetPx,
                    });
                }

                positionIndex.current = index;
            } else {
                positionIndex.current = null;
            }
        }
    }, [state, scrollRoot, returningToTop]);

    useEffect(() => {
        if (!returningToTop) {
            return;
        }

        const root = scrollRoot.current;

        if (!root) {
            return;
        }

        let frame: number | undefined;

        const scrollToNewest = () => {
            if (frame !== undefined) {
                cancelAnimationFrame(frame);
            }

            frame = requestAnimationFrame(() => {
                frame = undefined;
                const list = root.querySelector('ol');

                if (!list) {
                    return;
                }

                const reduceMotion = window.matchMedia?.(
                    '(prefers-reduced-motion: reduce)',
                ).matches;
                const scrollMargin =
                    list.getBoundingClientRect().top -
                    root.getBoundingClientRect().top +
                    root.scrollTop;
                virtuosoRef.current?.scrollToIndex({
                    index: 0,
                    align: 'start',
                    offset: -scrollMargin,
                    behavior: reduceMotion ? 'auto' : 'smooth',
                });
            });
        };

        const onScrollEnd = () => {
            // A data replacement can clamp the scroll position and interrupt the animation.
            if (root.scrollTop > 1) {
                scrollToNewest();
            }
        };

        scrollToNewest();
        root.addEventListener('scrollend', onScrollEnd);

        return () => {
            if (frame !== undefined) {
                cancelAnimationFrame(frame);
            }

            root.removeEventListener('scrollend', onScrollEnd);
        };
    }, [state.items, scrollRoot, returningToTop]);

    useEffect(() => {
        const root = scrollRoot.current;
        const anchor = position.current;

        if (!root || !anchor || !pinnedPosition.current || returningToTop) {
            restoringPosition.current = false;

            return;
        }

        let correctionFrame: number | undefined;
        let corrections = 0;
        let stableFrames = 0;
        let previousOffset = Number.NaN;
        const version = restorationVersion.current;
        const frame = requestAnimationFrame(() => {
            if (version !== restorationVersion.current) {
                return;
            }

            const currentAnchor = position.current;

            if (
                !root.isConnected ||
                !currentAnchor ||
                currentAnchor.recordId !== anchor.recordId ||
                currentAnchor.occurredAt !== anchor.occurredAt ||
                currentAnchor.offsetPx !== anchor.offsetPx
            ) {
                restoringPosition.current = false;

                return;
            }

            const index = stateRef.current.items.findIndex(
                (item) => item.recordId === anchor.recordId,
            );

            if (index < 0) {
                if (pinnedPosition.current?.recordId === anchor.recordId) {
                    pinnedPosition.current = null;
                }

                restoringPosition.current = false;

                return;
            }

            positionIndex.current = index;
            virtuosoRef.current?.scrollToIndex({
                index,
                align: 'start',
                offset: -anchor.offsetPx,
            });

            const correctAnchor = () => {
                if (version !== restorationVersion.current) {
                    return;
                }

                if (!root.isConnected || !samePosition(position.current, anchor)) {
                    restoringPosition.current = false;

                    return;
                }

                const row = root.querySelector<HTMLElement>(`[data-index="${index}"]`);

                if (!row) {
                    if (corrections < 8) {
                        corrections += 1;
                        correctionFrame = requestAnimationFrame(correctAnchor);

                        return;
                    }

                    restoringPosition.current = false;

                    return;
                }

                const currentOffset =
                    row.getBoundingClientRect().top - root.getBoundingClientRect().top;
                const correction = currentOffset - anchor.offsetPx;

                if (Math.abs(correction) > 1) {
                    root.scrollTop += correction;
                    corrections += 1;
                    stableFrames = 0;
                } else if (Math.abs(currentOffset - previousOffset) <= 0.5) {
                    stableFrames += 1;
                } else {
                    stableFrames = 0;
                }

                previousOffset = currentOffset;

                if (stableFrames < 6 && corrections < 120) {
                    correctionFrame = requestAnimationFrame(correctAnchor);

                    return;
                }

                pinnedPosition.current = null;
                updatePositionRef.current(anchor);
                restoringPosition.current = false;
            };

            correctionFrame = requestAnimationFrame(correctAnchor);
        });

        return () => {
            cancelAnimationFrame(frame);

            if (correctionFrame !== undefined) {
                cancelAnimationFrame(correctionFrame);
            }
        };
    }, [state.items, scrollRoot, returningToTop]);

    useEffect(() => {
        const root = scrollRoot.current;

        if (!root || typeof ResizeObserver === 'undefined') {
            return;
        }

        let previousWidth = root.clientWidth;
        let animationFrame: number | undefined;

        const resizeObserver = new ResizeObserver(() => {
            const nextWidth = root.clientWidth;

            if (nextWidth === previousWidth) {
                return;
            }

            previousWidth = nextWidth;

            if (returningToTop || !position.current) {
                return;
            }

            const anchor = position.current;
            const index = stateRef.current.items.findIndex(
                (item) => item.recordId === anchor.recordId,
            );

            if (index < 0) {
                return;
            }

            if (animationFrame !== undefined) {
                cancelAnimationFrame(animationFrame);
            }

            const version = restorationVersion.current;
            animationFrame = requestAnimationFrame(() => {
                animationFrame = undefined;
                const currentAnchor = position.current;

                if (
                    version !== restorationVersion.current ||
                    !root.isConnected ||
                    !samePosition(currentAnchor, anchor)
                ) {
                    return;
                }

                const currentIndex = stateRef.current.items.findIndex(
                    (item) => item.recordId === anchor.recordId,
                );

                if (currentIndex < 0) {
                    return;
                }

                positionIndex.current = currentIndex;
                virtuosoRef.current?.scrollToIndex({
                    index: currentIndex,
                    align: 'start',
                    offset: -anchor.offsetPx,
                });
            });
        });

        resizeObserver.observe(root);

        return () => {
            resizeObserver.disconnect();

            if (animationFrame !== undefined) {
                cancelAnimationFrame(animationFrame);
            }
        };
    }, [scrollRoot, returningToTop]);

    useEffect(() => {
        const root = scrollRoot.current;

        if (
            root &&
            focused.current &&
            (!focused.current.isConnected ||
                (focused.current instanceof HTMLButtonElement &&
                    focused.current.disabled &&
                    document.activeElement !== focused.current))
        ) {
            root.focus({ preventScroll: true });
            focused.current = root;
        }
    });

    return { virtuosoRef };
}

function samePosition(left: HistoryReadingPosition | null, right: HistoryReadingPosition | null) {
    return (
        left !== null &&
        right !== null &&
        left.recordId === right.recordId &&
        left.occurredAt === right.occurredAt &&
        left.offsetPx === right.offsetPx
    );
}
