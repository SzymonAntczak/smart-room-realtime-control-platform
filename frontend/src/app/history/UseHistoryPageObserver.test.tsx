import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHistoryPageObserver } from './use-history-page-observer';
import { createUserHistorySession, type UserHistorySessionState } from './user-history-session';

class TestIntersectionObserver {
    static instances: TestIntersectionObserver[] = [];
    readonly observed: Element[] = [];
    disconnected = false;

    constructor(
        private readonly callback: IntersectionObserverCallback,
        readonly options: IntersectionObserverInit,
    ) {
        TestIntersectionObserver.instances.push(this);
    }

    observe(target: Element) {
        this.observed.push(target);
    }

    disconnect() {
        this.disconnected = true;
    }

    trigger(target: Element, isIntersecting: boolean) {
        this.callback(
            [{ target, isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
        );
    }
}

class TestResizeObserver {
    static instances: TestResizeObserver[] = [];
    readonly observed: Element[] = [];
    disconnected = false;

    constructor(private readonly callback: ResizeObserverCallback) {
        TestResizeObserver.instances.push(this);
    }

    observe(target: Element) {
        this.observed.push(target);
    }

    disconnect() {
        this.disconnected = true;
    }

    trigger() {
        this.callback([], this as unknown as ResizeObserver);
    }
}

describe('history page observer', () => {
    const root = document.createElement('div');
    const anchor = document.createElement('div');
    const scrollRoot = { current: root };
    const anchorRef = { current: anchor };
    const readyState: UserHistorySessionState = {
        ...createUserHistorySession().getState(),
        status: 'ready',
        endReached: false,
        error: null,
    };

    beforeEach(() => {
        TestIntersectionObserver.instances = [];
        TestResizeObserver.instances = [];
        Object.defineProperty(root, 'clientHeight', { configurable: true, value: 320 });
        vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
        vi.stubGlobal('ResizeObserver', TestResizeObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('observes the sentinel one viewport before the content end and loads only on intersection', () => {
        const loadOlder = vi.fn();
        const { unmount } = renderHook(() =>
            useHistoryPageObserver({
                state: readyState,
                scrollRoot,
                anchor: anchorRef,
                loadOlder,
                disabled: false,
            }),
        );

        const observer = TestIntersectionObserver.instances[0];
        expect(observer?.options).toMatchObject({
            root,
            rootMargin: '0px 0px 320px 0px',
            threshold: 0,
        });
        expect(observer?.observed).toEqual([anchor]);

        act(() => observer?.trigger(anchor, false));
        expect(loadOlder).not.toHaveBeenCalled();

        act(() => observer?.trigger(anchor, true));
        expect(loadOlder).toHaveBeenCalledTimes(1);

        unmount();
        expect(observer?.disconnected).toBe(true);
        expect(TestResizeObserver.instances[0]?.disconnected).toBe(true);
    });

    it('reattaches for a new cursor even when a sparse page keeps the session ready', () => {
        const loadOlder = vi.fn();
        const { rerender, unmount } = renderHook(
            ({ state }: { state: UserHistorySessionState }) =>
                useHistoryPageObserver({
                    state,
                    scrollRoot,
                    anchor: anchorRef,
                    loadOlder,
                    disabled: false,
                }),
            { initialProps: { state: readyState } },
        );
        const first = TestIntersectionObserver.instances[0];

        rerender({ state: { ...readyState, nextCursor: 'next-page' } });

        expect(first?.disconnected).toBe(true);
        expect(TestIntersectionObserver.instances).toHaveLength(2);
        expect(TestIntersectionObserver.instances[1]?.observed).toEqual([anchor]);

        unmount();
    });

    it('rebuilds the observer when the scroll viewport resizes and stops outside the ready state', () => {
        const loadOlder = vi.fn();
        const { rerender, unmount } = renderHook(
            ({ state }: { state: UserHistorySessionState }) =>
                useHistoryPageObserver({
                    state,
                    scrollRoot,
                    anchor: anchorRef,
                    loadOlder,
                    disabled: false,
                }),
            { initialProps: { state: readyState } },
        );
        const first = TestIntersectionObserver.instances[0];
        Object.defineProperty(root, 'clientHeight', { configurable: true, value: 640 });

        act(() => TestResizeObserver.instances[0]?.trigger());

        expect(first?.disconnected).toBe(true);
        expect(TestIntersectionObserver.instances[1]?.options.rootMargin).toBe('0px 0px 640px 0px');

        rerender({ state: { ...readyState, status: 'error', error: 'request_failed' } });
        expect(TestIntersectionObserver.instances[1]?.disconnected).toBe(true);
        expect(TestResizeObserver.instances[0]?.disconnected).toBe(true);
        expect(TestIntersectionObserver.instances).toHaveLength(2);

        unmount();
    });
});
