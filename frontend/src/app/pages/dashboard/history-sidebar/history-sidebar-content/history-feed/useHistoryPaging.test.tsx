import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHistorySession, type HistorySessionState } from '../history-session';

import { useHistoryPaging } from './useHistoryPaging';

class TestResizeObserver {
    static instances: TestResizeObserver[] = [];
    disconnected = false;

    constructor(private readonly callback: ResizeObserverCallback) {
        TestResizeObserver.instances.push(this);
    }

    observe() {}

    disconnect() {
        this.disconnected = true;
    }

    trigger() {
        this.callback([], this as unknown as ResizeObserver);
    }
}

describe('history paging', () => {
    const root = document.createElement('div');
    const readyState: HistorySessionState = {
        ...createHistorySession().getState(),
        status: 'ready',
        items: [],
        nextCursor: 'older',
        endReached: false,
        error: null,
    };

    beforeEach(() => {
        TestResizeObserver.instances = [];
        Object.defineProperty(root, 'clientHeight', { configurable: true, value: 320 });
        vi.stubGlobal('ResizeObserver', TestResizeObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses the measured viewport as the bottom prefetch buffer and updates it on resize', () => {
        const { result, unmount } = renderHook(() =>
            useHistoryPaging({
                returningToTop: false,
                state: readyState,
                scrollViewport: root,
                loadOlder: vi.fn(),
            }),
        );

        expect(result.current.increaseViewportBy).toEqual({ top: 0, bottom: 320 });

        Object.defineProperty(root, 'clientHeight', { configurable: true, value: 640 });
        act(() => TestResizeObserver.instances[0]?.trigger());

        expect(result.current.increaseViewportBy).toEqual({ top: 0, bottom: 640 });

        unmount();
        expect(TestResizeObserver.instances[0]?.disconnected).toBe(true);
    });

    it('loads when Virtuoso reports the end of the rendered range and waits when it leaves it', () => {
        const loadOlder = vi.fn();
        const state = { ...readyState, items: [createHistoryItem()] };
        const { result, rerender } = renderHook(
            ({ currentState }: { currentState: HistorySessionState }) =>
                useHistoryPaging({
                    returningToTop: false,
                    state: currentState,
                    scrollViewport: root,
                    loadOlder,
                }),
            { initialProps: { currentState: state } },
        );

        act(() => result.current.rangeChanged({ startIndex: 0, endIndex: 0 }));
        rerender({ currentState: { ...state, nextCursor: 'next' } });
        expect(loadOlder).toHaveBeenCalledTimes(1);

        loadOlder.mockClear();
        act(() => result.current.rangeChanged({ startIndex: 0, endIndex: -1 }));
        rerender({ currentState: { ...state, nextCursor: 'after-scroll-away' } });
        expect(loadOlder).not.toHaveBeenCalled();
    });

    it('continues through empty and duplicate pages when each cursor completes', () => {
        const loadOlder = vi.fn();
        const { result, rerender } = renderHook(
            ({ currentState }: { currentState: HistorySessionState }) =>
                useHistoryPaging({
                    returningToTop: false,
                    state: currentState,
                    scrollViewport: root,
                    loadOlder,
                }),
            { initialProps: { currentState: readyState } },
        );

        expect(loadOlder).toHaveBeenCalledTimes(1);

        rerender({ currentState: { ...readyState, nextCursor: 'sparse-next' } });
        expect(loadOlder).toHaveBeenCalledTimes(2);

        const item = createHistoryItem();
        const populated = { ...readyState, items: [item], nextCursor: 'duplicate-next' };
        rerender({ currentState: populated });
        act(() => result.current.endReached(0));
        expect(loadOlder).toHaveBeenCalledTimes(3);

        rerender({ currentState: { ...populated, nextCursor: 'after-duplicate' } });
        expect(loadOlder).toHaveBeenCalledTimes(4);
    });

    it('does not load while an error is shown, a request is active, or history has ended', () => {
        const loadOlder = vi.fn();
        const { result, rerender } = renderHook(
            ({ currentState }: { currentState: HistorySessionState }) =>
                useHistoryPaging({
                    returningToTop: false,
                    state: currentState,
                    scrollViewport: root,
                    loadOlder,
                }),
            { initialProps: { currentState: { ...readyState, status: 'loading' } } },
        );

        rerender({ currentState: { ...readyState, status: 'error', error: 'request_failed' } });
        act(() => result.current.endReached(-1));
        rerender({ currentState: { ...readyState, nextCursor: null } });
        expect(loadOlder).not.toHaveBeenCalled();
    });

    it('does not fetch older pages while returning to newest and resumes at the current rendered boundary', () => {
        const loadOlder = vi.fn();
        const state = { ...readyState, items: [createHistoryItem()] };
        const { result, rerender } = renderHook(
            ({ returningToTop, currentState }) =>
                useHistoryPaging({
                    state: currentState,
                    scrollViewport: root,
                    loadOlder,
                    returningToTop,
                }),
            { initialProps: { currentState: state, returningToTop: true } },
        );
        act(() => result.current.endReached(0));
        rerender({
            currentState: { ...state, nextCursor: 'refetched-page' },
            returningToTop: true,
        });
        expect(loadOlder).not.toHaveBeenCalled();

        act(() => result.current.rangeChanged({ startIndex: 0, endIndex: -1 }));
        rerender({ currentState: state, returningToTop: false });
        expect(loadOlder).not.toHaveBeenCalled();
        act(() => result.current.endReached(0));
        expect(loadOlder).toHaveBeenCalledOnce();
    });
});

function createHistoryItem() {
    return {
        ...createUserHistoryFixtures().gap,
        recordId: `rec:v1:sha256:${'1'.repeat(64)}`,
    };
}
