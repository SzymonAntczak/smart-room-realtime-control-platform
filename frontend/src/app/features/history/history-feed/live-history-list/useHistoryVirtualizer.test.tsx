import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useInsertionEffect, useRef } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHistorySession, type HistorySessionState } from '../history-session';

import { useHistoryVirtualizer } from './useHistoryVirtualizer';

const controls = vi.hoisted(() => ({
    scrollToIndex: vi.fn(),
}));

class TestResizeObserver {
    static instances: TestResizeObserver[] = [];

    constructor(private readonly callback: ResizeObserverCallback) {
        TestResizeObserver.instances.push(this);
    }

    observe() {}

    disconnect() {}

    trigger() {
        this.callback([], this as unknown as ResizeObserver);
    }
}

function Harness({
    state,
    updateReadingPosition,
    returningToTop = false,
    showControl = true,
}: {
    state: HistorySessionState;
    updateReadingPosition: (position: HistorySessionState['position']) => void;
    returningToTop?: boolean;
    showControl?: boolean;
}) {
    const scrollRoot = useRef<HTMLDivElement | null>(null);
    const { virtuosoRef } = useHistoryVirtualizer({
        state,
        scrollRoot,
        returningToTop,
        updateReadingPosition,
    });

    useInsertionEffect(() => {
        virtuosoRef.current = {
            scrollToIndex: controls.scrollToIndex,
        } as unknown as VirtuosoHandle;
    }, [virtuosoRef]);

    return (
        <>
            <div ref={scrollRoot} role="region" aria-label="History" tabIndex={0}>
                <ol>
                    {state.items.map((item, index) => (
                        <li key={item.recordId} data-index={index} />
                    ))}
                </ol>
                {showControl ? <button>Retry</button> : null}
            </div>
            <button>Outside history</button>
        </>
    );
}

function controlAnimationFrames() {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        const id = ++nextFrame;
        frames.set(id, callback);

        return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => frames.delete(id));

    return () =>
        act(() => {
            const pending = [...frames.values()];
            frames.clear();
            pending.forEach((callback) => callback(0));
        });
}

describe('history position controller', () => {
    const items = ['first', 'anchor', 'last'].map((recordId) => ({
        recordId,
        occurredAt: '2026-09-10T10:00:00.000Z',
        source: 'backend' as const,
        durability: 'volatile' as const,
        kind: 'history_gap' as const,
        outageStartedAt: '2026-09-10T09:59:00.000Z',
        outageEndedAt: '2026-09-10T10:00:00.000Z',
    }));
    const readyState: HistorySessionState = {
        ...createHistorySession().getState(),
        status: 'ready',
        items,
        historyGenerationId: 'generation-one',
    };
    const anchor = { recordId: 'anchor', occurredAt: items[1].occurredAt, offsetPx: -24 };

    beforeEach(() => {
        vi.clearAllMocks();
        TestResizeObserver.instances = [];
        vi.stubGlobal('ResizeObserver', TestResizeObserver);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
            this: HTMLElement,
        ) {
            const top = this.tagName === 'LI' ? Number(this.dataset.index) * 200 - 24 : 0;

            return new DOMRect(0, top, 320, 100);
        });
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('restores the saved entry by identity through Virtuoso public methods', () => {
        render(
            <Harness state={{ ...readyState, position: anchor }} updateReadingPosition={vi.fn()} />,
        );

        expect(controls.scrollToIndex).toHaveBeenCalledWith({
            index: 1,
            align: 'start',
            offset: 24,
        });
    });

    it('tracks the visible entry and its container-relative offset on scroll', () => {
        const updateReadingPosition = vi.fn();
        render(<Harness state={readyState} updateReadingPosition={updateReadingPosition} />);
        const root = screen.getByRole('region');
        Object.defineProperty(root, 'scrollTop', {
            configurable: true,
            writable: true,
            value: 100,
        });

        fireEvent.scroll(root);

        expect(updateReadingPosition).toHaveBeenLastCalledWith({
            recordId: 'first',
            occurredAt: items[0].occurredAt,
            offsetPx: -24,
        });
    });

    it.each([
        ['wheel', (root: HTMLElement) => fireEvent.wheel(root, { deltaY: 100 })],
        ['touch', (root: HTMLElement) => fireEvent.touchStart(root)],
        ['touch movement', (root: HTMLElement) => fireEvent.touchMove(root)],
        ['pointer', (root: HTMLElement) => fireEvent.pointerDown(root)],
        ['keyboard', (root: HTMLElement) => fireEvent.keyDown(root, { key: 'ArrowDown' })],
    ] as const)(
        'lets %s scrolling interrupt live-entry anchor corrections',
        async (_name, scrollIntent) => {
            const runFrame = controlAnimationFrames();
            const updateReadingPosition = vi.fn();
            const savedPosition = { ...anchor, offsetPx: 0 };
            const { rerender } = render(
                <Harness
                    state={{ ...readyState, position: savedPosition }}
                    updateReadingPosition={updateReadingPosition}
                />,
            );
            const root = screen.getByRole('region');
            root.scrollTop = 200;
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
                this: HTMLElement,
            ) {
                const top =
                    this.tagName === 'LI' ? Number(this.dataset.index) * 200 - root.scrollTop : 0;

                return new DOMRect(0, top, 320, 200);
            });
            controls.scrollToIndex.mockImplementation(({ index, offset }) => {
                root.scrollTop = index * 200 + offset;
                fireEvent.scroll(root);
            });
            const newest = { ...items[0], recordId: 'newest' };

            rerender(
                <Harness
                    state={{ ...readyState, items: [newest, ...items], position: savedPosition }}
                    updateReadingPosition={updateReadingPosition}
                />,
            );
            await runFrame();
            await runFrame();
            expect(root.scrollTop).toBe(400);
            expect(updateReadingPosition).not.toHaveBeenCalled();

            scrollIntent(root);
            root.scrollTop += 100;
            fireEvent.scroll(root);
            await runFrame();
            await runFrame();

            expect(root.scrollTop).toBe(500);
            expect(updateReadingPosition).toHaveBeenLastCalledWith({
                ...savedPosition,
                offsetPx: -100,
            });
        },
    );

    it('restores the reading anchor after the scroll viewport width changes', () => {
        render(
            <Harness state={{ ...readyState, position: anchor }} updateReadingPosition={vi.fn()} />,
        );
        const root = screen.getByRole('region');
        Object.defineProperty(root, 'clientWidth', { configurable: true, value: 400 });
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            callback(0);

            return 1;
        });
        controls.scrollToIndex.mockClear();

        act(() => TestResizeObserver.instances[0]?.trigger());

        expect(controls.scrollToIndex).toHaveBeenCalledWith({
            index: 1,
            align: 'start',
            offset: 24,
        });
    });

    it('does not restore a shifted anchor while returning to the newest entries', () => {
        const updateReadingPosition = vi.fn();
        const { rerender } = render(
            <Harness
                state={{ ...readyState, position: anchor }}
                updateReadingPosition={updateReadingPosition}
                returningToTop
            />,
        );
        const prepended = {
            ...items[0],
            recordId: 'newest',
            occurredAt: '2026-09-10T10:01:00.000Z',
        };

        rerender(
            <Harness
                state={{ ...readyState, items: [prepended, ...items], position: anchor }}
                updateReadingPosition={updateReadingPosition}
                returningToTop
            />,
        );

        expect(controls.scrollToIndex).not.toHaveBeenCalled();
    });

    it('returns focus when a control disappears and does not reclaim focus from outside', () => {
        const updateReadingPosition = vi.fn();
        const { rerender } = render(
            <Harness state={readyState} updateReadingPosition={updateReadingPosition} />,
        );
        screen.getByRole('button', { name: 'Retry' }).focus();
        rerender(
            <Harness
                state={readyState}
                updateReadingPosition={updateReadingPosition}
                showControl={false}
            />,
        );
        expect(screen.getByRole('region')).toHaveFocus();

        rerender(<Harness state={readyState} updateReadingPosition={updateReadingPosition} />);
        const outside = screen.getByRole('button', { name: 'Outside history' });
        screen.getByRole('button', { name: 'Retry' }).focus();
        act(() => fireEvent.pointerDown(outside));
        outside.focus();
        rerender(
            <Harness
                state={readyState}
                updateReadingPosition={updateReadingPosition}
                showControl={false}
            />,
        );
        expect(outside).toHaveFocus();
    });

    it.each([false, true])(
        'keeps return-to-top corrections consistent with reduced motion = %s',
        (reduceMotion) => {
            const frames: FrameRequestCallback[] = [];
            vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
                frames.push(callback);

                return frames.length;
            });
            vi.stubGlobal('matchMedia', () => ({ matches: reduceMotion }));
            const updateReadingPosition = vi.fn();
            const { rerender } = render(
                <Harness state={readyState} updateReadingPosition={updateReadingPosition} />,
            );
            const root = screen.getByRole('region');
            const scrollTo = vi.fn();
            Object.defineProperty(root, 'scrollTo', { configurable: true, value: scrollTo });

            rerender(
                <Harness
                    state={readyState}
                    updateReadingPosition={updateReadingPosition}
                    returningToTop
                />,
            );
            act(() => frames.splice(0).forEach((callback) => callback(0)));
            expect(controls.scrollToIndex).toHaveBeenCalledExactlyOnceWith({
                index: 0,
                align: 'start',
                offset: -0,
                behavior: reduceMotion ? 'auto' : 'smooth',
            });

            rerender(
                <Harness
                    state={{ ...readyState, items: [...items] }}
                    updateReadingPosition={updateReadingPosition}
                    returningToTop
                />,
            );
            act(() => frames.splice(0).forEach((callback) => callback(16)));
            expect(controls.scrollToIndex.mock.calls).toEqual([
                [
                    {
                        index: 0,
                        align: 'start',
                        offset: -0,
                        behavior: reduceMotion ? 'auto' : 'smooth',
                    },
                ],
                [
                    {
                        index: 0,
                        align: 'start',
                        offset: -0,
                        behavior: reduceMotion ? 'auto' : 'smooth',
                    },
                ],
            ]);
            expect(scrollTo).not.toHaveBeenCalled();
        },
    );

    it('resumes a return animation interrupted by data replacement and stops retrying after cancellation', () => {
        const frames = new Map<number, FrameRequestCallback>();
        let nextFrame = 0;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            const id = ++nextFrame;
            frames.set(id, callback);

            return id;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => frames.delete(id));
        vi.stubGlobal('matchMedia', () => ({ matches: false }));
        const updateReadingPosition = vi.fn();
        const { rerender } = render(
            <Harness
                state={readyState}
                updateReadingPosition={updateReadingPosition}
                returningToTop
            />,
        );
        const root = screen.getByRole('region');
        Object.defineProperty(root, 'scrollTop', {
            configurable: true,
            writable: true,
            value: 100,
        });
        const list = screen.getByRole('list');
        Object.defineProperty(list, 'getBoundingClientRect', {
            configurable: true,
            value: () => new DOMRect(0, -root.scrollTop, 320, 600),
        });
        const runFrame = () =>
            act(() => {
                const pending = [...frames.values()];
                frames.clear();
                pending.forEach((callback) => callback(0));
            });
        runFrame();
        expect(controls.scrollToIndex).toHaveBeenCalledExactlyOnceWith({
            index: 0,
            align: 'start',
            offset: -0,
            behavior: 'smooth',
        });

        root.scrollTop = 80;
        fireEvent(root, new Event('scrollend'));
        runFrame();
        expect(controls.scrollToIndex).toHaveBeenCalledTimes(2);
        expect(controls.scrollToIndex).toHaveBeenLastCalledWith({
            index: 0,
            align: 'start',
            offset: -0,
            behavior: 'smooth',
        });

        fireEvent(root, new Event('scrollend'));
        rerender(<Harness state={readyState} updateReadingPosition={updateReadingPosition} />);
        fireEvent(root, new Event('scrollend'));
        runFrame();
        expect(controls.scrollToIndex).toHaveBeenCalledTimes(2);
    });
});
