import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHistorySession, type HistorySessionState } from '../history-session';

import { useHistoryPaging } from './useHistoryPaging';

describe('history paging', () => {
    afterEach(() => vi.restoreAllMocks());

    const root = document.createElement('div');
    const readyState: HistorySessionState = {
        ...createHistorySession().getState(),
        status: 'ready',
        items: [],
        nextCursor: 'older',
        endReached: false,
        error: null,
    };

    it('loads the next page only after scrolling within the prefetch offset', () => {
        const loadOlder = vi.fn();
        Object.defineProperties(root, {
            clientHeight: { configurable: true, value: 320 },
            scrollHeight: { configurable: true, value: 1200 },
            scrollTop: { configurable: true, writable: true, value: 0 },
        });
        const { unmount } = renderHook(() =>
            useHistoryPaging({
                returningToTop: false,
                state: readyState,
                scrollViewport: root,
                loadOlder,
            }),
        );

        expect(loadOlder).not.toHaveBeenCalled();
        act(() => {
            root.scrollTop = 600;
            root.dispatchEvent(new Event('scroll'));
        });
        expect(loadOlder).not.toHaveBeenCalled();

        act(() => {
            root.scrollTop = 500;
            root.dispatchEvent(new Event('pointerdown'));
            root.dispatchEvent(new Event('scroll'));
        });
        expect(loadOlder).not.toHaveBeenCalled();

        act(() => {
            root.scrollTop = 600;
            root.dispatchEvent(new Event('scroll'));
        });
        expect(loadOlder).toHaveBeenCalledOnce();
        unmount();
    });

    it('waits for another user scroll before continuing through an empty page', () => {
        const loadOlder = vi.fn();
        Object.defineProperties(root, {
            clientHeight: { configurable: true, value: 320 },
            scrollHeight: { configurable: true, value: 1200 },
            scrollTop: { configurable: true, writable: true, value: 600 },
        });
        const { rerender } = renderHook(
            ({ currentState }: { currentState: HistorySessionState }) =>
                useHistoryPaging({
                    returningToTop: false,
                    state: currentState,
                    scrollViewport: root,
                    loadOlder,
                }),
            { initialProps: { currentState: readyState } },
        );

        expect(loadOlder).not.toHaveBeenCalled();
        act(() => {
            root.dispatchEvent(new Event('wheel'));
            root.dispatchEvent(new Event('scroll'));
        });
        expect(loadOlder).toHaveBeenCalledOnce();

        rerender({ currentState: { ...readyState, status: 'loading' } });
        rerender({ currentState: { ...readyState, nextCursor: 'sparse-next' } });
        expect(loadOlder).toHaveBeenCalledOnce();

        act(() => root.dispatchEvent(new Event('scroll')));
        expect(loadOlder).toHaveBeenCalledOnce();

        act(() => {
            root.dispatchEvent(new Event('wheel'));
            root.dispatchEvent(new Event('scroll'));
        });
        expect(loadOlder).toHaveBeenCalledTimes(2);
    });

    it('requests one page per approach even before the virtual list measures the added page', () => {
        const loadOlder = vi.fn();
        Object.defineProperties(root, {
            clientHeight: { configurable: true, value: 320 },
            scrollHeight: { configurable: true, value: 1200 },
            scrollTop: { configurable: true, writable: true, value: 600 },
        });
        const { rerender } = renderHook(
            ({ currentState }: { currentState: HistorySessionState }) =>
                useHistoryPaging({
                    returningToTop: false,
                    state: currentState,
                    scrollViewport: root,
                    loadOlder,
                }),
            { initialProps: { currentState: readyState } },
        );

        act(() => {
            root.dispatchEvent(new Event('wheel'));
            root.dispatchEvent(new Event('scroll'));
            root.dispatchEvent(new Event('wheel'));
            root.dispatchEvent(new Event('scroll'));
        });
        expect(loadOlder).toHaveBeenCalledOnce();

        rerender({ currentState: { ...readyState, status: 'loading' } });
        act(() => {
            root.dispatchEvent(new Event('wheel'));
            root.dispatchEvent(new Event('scroll'));
        });
        rerender({ currentState: { ...readyState, nextCursor: 'next-page' } });
        act(() => root.dispatchEvent(new Event('scroll')));
        expect(loadOlder).toHaveBeenCalledOnce();

        Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 2200 });
        act(() => {
            root.dispatchEvent(new Event('wheel'));
            root.dispatchEvent(new Event('scroll'));
        });
        expect(loadOlder).toHaveBeenCalledOnce();

        act(() => {
            root.scrollTop = 1600;
            root.dispatchEvent(new Event('wheel'));
            root.dispatchEvent(new Event('scroll'));
        });
        expect(loadOlder).toHaveBeenCalledTimes(2);
    });

    it('does not load when history has an error or has ended', () => {
        const loadOlder = vi.fn();
        Object.defineProperties(root, {
            clientHeight: { configurable: true, value: 320 },
            scrollHeight: { configurable: true, value: 1200 },
            scrollTop: { configurable: true, writable: true, value: 600 },
        });
        const { rerender } = renderHook(
            ({ currentState }: { currentState: HistorySessionState }) =>
                useHistoryPaging({
                    returningToTop: false,
                    state: currentState,
                    scrollViewport: root,
                    loadOlder,
                }),
            { initialProps: { currentState: { ...readyState, status: 'loading' } } },
        );

        act(() => {
            root.dispatchEvent(new Event('wheel'));
            root.dispatchEvent(new Event('scroll'));
        });
        rerender({ currentState: { ...readyState, status: 'error', error: 'request_failed' } });
        rerender({ currentState: { ...readyState, nextCursor: null, endReached: true } });
        expect(loadOlder).not.toHaveBeenCalled();
    });

    it('allows an explicit scroll attempt to advance an empty page without a scrollbar', () => {
        const loadOlder = vi.fn();
        let boundaryCheck: FrameRequestCallback | undefined;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            boundaryCheck = callback;

            return 1;
        });
        Object.defineProperties(root, {
            clientHeight: { configurable: true, value: 320 },
            scrollHeight: { configurable: true, value: 320 },
            scrollTop: { configurable: true, writable: true, value: 0 },
        });
        const { rerender } = renderHook(
            ({ currentState }: { currentState: HistorySessionState }) =>
                useHistoryPaging({
                    state: currentState,
                    scrollViewport: root,
                    loadOlder,
                    returningToTop: false,
                }),
            { initialProps: { currentState: readyState } },
        );

        expect(loadOlder).not.toHaveBeenCalled();
        act(() => root.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' })));
        expect(loadOlder).not.toHaveBeenCalled();
        act(() => boundaryCheck?.(0));
        expect(loadOlder).toHaveBeenCalledOnce();
        rerender({ currentState: { ...readyState, status: 'loading' } });
        rerender({ currentState: { ...readyState, nextCursor: 'next-page' } });
        expect(loadOlder).toHaveBeenCalledOnce();

        act(() => root.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 })));
        expect(loadOlder).toHaveBeenCalledOnce();
        act(() => boundaryCheck?.(0));
        expect(loadOlder).toHaveBeenCalledTimes(2);
    });

    it('waits for a new near-end scroll after returning to newest', () => {
        const loadOlder = vi.fn();
        Object.defineProperties(root, {
            clientHeight: { configurable: true, value: 320 },
            scrollHeight: { configurable: true, value: 1200 },
            scrollTop: { configurable: true, writable: true, value: 600 },
        });
        const { rerender } = renderHook(
            ({ returningToTop }: { returningToTop: boolean }) =>
                useHistoryPaging({
                    state: readyState,
                    scrollViewport: root,
                    loadOlder,
                    returningToTop,
                }),
            { initialProps: { returningToTop: true } },
        );

        act(() => {
            root.dispatchEvent(new Event('wheel'));
            root.dispatchEvent(new Event('scroll'));
        });
        expect(loadOlder).not.toHaveBeenCalled();

        rerender({ returningToTop: false });
        expect(loadOlder).not.toHaveBeenCalled();

        act(() => {
            root.dispatchEvent(new Event('wheel'));
            root.dispatchEvent(new Event('scroll'));
        });
        expect(loadOlder).toHaveBeenCalledOnce();
    });
});
