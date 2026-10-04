import {
    defaultRangeExtractor,
    observeElementOffset,
    type Range,
    useVirtualizer,
} from '@tanstack/react-virtual';
import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { UserHistoryReadingPosition, UserHistorySessionState } from './user-history-session';

/** Geometry belongs here; identity, pagination and recovery policy belong to the session. */
export function useUserHistoryVirtualizer({
    state,
    scrollRoot,
    updateReadingPosition,
}: {
    state: UserHistorySessionState;
    scrollRoot: RefObject<HTMLElement | null>;
    updateReadingPosition(position: UserHistoryReadingPosition | null): void;
}) {
    const listRef = useRef<HTMLOListElement | null>(null);
    const position = useRef<UserHistoryReadingPosition | null>(null);
    const current = useRef({ state, updateReadingPosition });
    const expectedScroll = useRef<number | null>(null);
    const smoothTopInProgress = useRef(false);
    const smoothTopRequested = useRef(false);
    const [smoothScrollActive, setSmoothScrollActive] = useState(false);
    const focused = useRef<HTMLElement | null>(null);
    const [geometry, setGeometry] = useState({ scrollMargin: 0, gap: 0 });
    const anchorIndex = state.position
        ? state.items.findIndex((item) => item.recordId === state.position?.recordId)
        : -1;
    const virtualizer = useVirtualizer<HTMLElement, HTMLLIElement>({
        count: state.items.length,
        getScrollElement: () => scrollRoot.current,
        estimateSize: () => 192,
        getItemKey: useCallback(
            (index: number) => state.items[index]?.recordId ?? index,
            [state.items],
        ),
        overscan: 5,
        ...geometry,
        rangeExtractor: useCallback(
            (range: Range) => {
                const indexes = defaultRangeExtractor(range);

                return anchorIndex < 0 || indexes.includes(anchorIndex)
                    ? indexes
                    : [...indexes, anchorIndex].sort((a, b) => a - b);
            },
            [anchorIndex],
        ),
        // Capture the reading position BEFORE the library synchronously renders a new range.
        observeElementOffset: (instance, callback) =>
            observeElementOffset(instance, (offset, scrolling) => {
                const root = scrollRoot.current;

                if (smoothTopInProgress.current && offset <= 1) {
                    smoothTopInProgress.current = false;
                    setSmoothScrollActive(false);
                }

                if (
                    !smoothTopInProgress.current &&
                    scrolling &&
                    root &&
                    (expectedScroll.current === null ||
                        Math.abs(offset - expectedScroll.current) > 1)
                ) {
                    const visibleOffset = offset;
                    const candidate = instance.getVirtualItemForOffset(visibleOffset);
                    // A gap belongs to neither row: anchor the next visible item, not the
                    // already obscured row returned by the virtualizer's start-offset search.
                    const row =
                        candidate && candidate.end <= visibleOffset
                            ? instance.measurementsCache[candidate.index + 1]
                            : candidate;
                    const item = row ? current.current.state.items[row.index] : undefined;
                    const entry = row ? instance.elementsCache.get(row.key) : undefined;
                    position.current =
                        offset <= 1 || !row || !item
                            ? null
                            : {
                                  recordId: item.recordId,
                                  occurredAt: item.occurredAt,
                                  offsetPx: entry
                                      ? entry.getBoundingClientRect().top -
                                        root.getBoundingClientRect().top
                                      : row.start - offset,
                              };
                    current.current.updateReadingPosition(position.current);
                    expectedScroll.current = null;
                }

                callback(offset, scrolling);
            }),
    });

    // This hook is the single scroll-adjustment owner, including measured-height changes.
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;

    useLayoutEffect(() => {
        const returningToNewest = position.current !== null && state.position === null;

        if (returningToNewest) {
            smoothTopRequested.current = true;
        }

        current.current = { state, updateReadingPosition };
        position.current = state.position;
        const keys = new Set(state.items.map((item) => item.recordId));

        for (const key of virtualizer.itemSizeCache.keys()) {
            if (!keys.has(String(key))) {
                virtualizer.itemSizeCache.delete(key);
            }
        }
    }, [state, updateReadingPosition, virtualizer]);

    useLayoutEffect(() => {
        virtualizer.measure();

        for (const element of virtualizer.elementsCache.values()) {
            virtualizer.measureElement(element);
        }
    }, [state.historyGenerationId, virtualizer]);

    useLayoutEffect(() => {
        // Ref cleanup runs before DOM removal; purge detached nodes after the commit.
        virtualizer.measureElement(null);
        const root = scrollRoot.current;
        const list = listRef.current;

        if (!root || !list) {
            return;
        }

        const scrollMargin =
            list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
        const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
        setGeometry((previous) =>
            previous.scrollMargin === scrollMargin && previous.gap === gap
                ? previous
                : { scrollMargin, gap },
        );
        const anchor = position.current;
        const row = anchor
            ? virtualizer.measurementsCache.find((item) => item.key === anchor.recordId)
            : undefined;
        const entry = row ? virtualizer.elementsCache.get(row.key) : undefined;
        const target =
            anchor && row
                ? entry
                    ? root.scrollTop +
                      entry.getBoundingClientRect().top -
                      root.getBoundingClientRect().top -
                      anchor.offsetPx
                    : row.start - anchor.offsetPx
                : anchor
                  ? root.scrollTop
                  : 0;
        const shouldScrollSmoothly =
            smoothTopRequested.current &&
            root.scrollTop > 1 &&
            !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        smoothTopRequested.current = false;

        if (Math.abs(target - root.scrollTop) > 0.5) {
            if (shouldScrollSmoothly) {
                smoothTopInProgress.current = true;
                setSmoothScrollActive(true);
                root.scrollTo({ top: target, behavior: 'smooth' });
            } else if (!smoothTopInProgress.current) {
                root.scrollTop = target;
            }

            expectedScroll.current = root.scrollTop;
        }

        if (
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

    useLayoutEffect(() => {
        const root = scrollRoot.current;
        const list = listRef.current;

        if (!root || !list) {
            return;
        }

        let width = root.clientWidth;
        const observer = new ResizeObserver(() => {
            if (width !== root.clientWidth) {
                width = root.clientWidth;
                virtualizer.measure();

                for (const element of virtualizer.elementsCache.values()) {
                    virtualizer.measureElement(element);
                }
            }

            const scrollMargin =
                list.getBoundingClientRect().top -
                root.getBoundingClientRect().top +
                root.scrollTop;
            const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
            setGeometry((previous) =>
                previous.scrollMargin === scrollMargin && previous.gap === gap
                    ? previous
                    : { scrollMargin, gap },
            );
        });
        observer.observe(root);
        observer.observe(list);

        const onFocus = (event: FocusEvent) => {
            focused.current = event.target instanceof HTMLElement ? event.target : null;
        };

        const onBlur = (event: FocusEvent) => {
            if (event.relatedTarget instanceof Node && !root.contains(event.relatedTarget)) {
                focused.current = null;
            }
        };

        // Clicking nonfocusable content blurs to BODY with a null relatedTarget.
        // Record the user's departure before that ambiguous blur; lifecycle blur
        // from disabling/removing a control still retains its recovery target.
        const onPointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && !root.contains(event.target)) {
                focused.current = null;
            }
        };

        const onScrollIntent = () => {
            smoothTopInProgress.current = false;
            setSmoothScrollActive(false);
            expectedScroll.current = null;
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (
                [' ', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp'].includes(
                    event.key,
                )
            ) {
                onScrollIntent();
            }
        };

        root.addEventListener('focusin', onFocus);
        root.addEventListener('focusout', onBlur);
        root.addEventListener('wheel', onScrollIntent, { passive: true });
        root.addEventListener('touchstart', onScrollIntent, { passive: true });
        root.addEventListener('pointerdown', onScrollIntent);
        root.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown, true);

        return () => {
            observer.disconnect();
            root.removeEventListener('focusin', onFocus);
            root.removeEventListener('focusout', onBlur);
            root.removeEventListener('wheel', onScrollIntent);
            root.removeEventListener('touchstart', onScrollIntent);
            root.removeEventListener('pointerdown', onScrollIntent);
            root.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown, true);
        };
    }, [scrollRoot, virtualizer]);

    const rows = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();

    return {
        listRef,
        rows,
        totalSize,
        scrollMargin: geometry.scrollMargin,
        measureElement: virtualizer.measureElement,
        smoothScrollActive,
    };
}
