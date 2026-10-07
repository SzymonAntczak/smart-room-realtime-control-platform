import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    loadOlder: vi.fn(),
    retry: vi.fn(),
    showNewest: vi.fn(),
    updateReadingPosition: vi.fn(),
}));
const source = {
    subscribe: () => () => undefined,
    getBaseline: () => undefined,
    requestBaseline: () => undefined,
};

vi.mock('./history-feed/HistoryFeed', () => ({ HistoryFeed: () => null }));
vi.mock('./useHistory', () => ({
    useHistory: () => ({
        state: {
            status: 'ready',
            items: [],
            historyGenerationId: null,
            throughSequence: null,
            retentionAsOf: null,
            nextCursor: null,
            endReached: true,
            lastKnown: false,
            overlayOverflow: false,
            hasNewEvents: false,
            position: null,
            notice: null,
            error: null,
        },
        loadOlder: mocks.loadOlder,
        retry: mocks.retry,
        showNewest: mocks.showNewest,
        updateReadingPosition: mocks.updateReadingPosition,
    }),
}));

import { HistorySidebarContent } from './HistorySidebarContent';

describe('HistorySidebarContent controls', () => {
    beforeEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('keeps filter inactive and returns to newest when away from the top', () => {
        render(
            <HistorySidebarContent
                source={source}
                devices={[]}
                realtimeUncertain={false}
                waitingForRoom={false}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Filtruj' }));
        expect(mocks.showNewest).not.toHaveBeenCalled();
        expect(mocks.loadOlder).not.toHaveBeenCalled();

        const region = screen.getByRole('region', { name: 'Przewijana historia zdarzeń' });
        Object.defineProperty(region, 'scrollTop', { configurable: true, value: 2 });
        const scrollTo = vi.fn();
        Object.defineProperty(region, 'scrollTo', { configurable: true, value: scrollTo });
        vi.stubGlobal('matchMedia', () => ({ matches: false }));
        fireEvent.click(screen.getByRole('button', { name: 'Na górę' }));
        expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
        expect(mocks.showNewest).toHaveBeenCalledOnce();
    });

    it('keeps return to top immediate when reduced motion is preferred', () => {
        render(
            <HistorySidebarContent
                source={source}
                devices={[]}
                realtimeUncertain={false}
                waitingForRoom={false}
            />,
        );

        const region = screen.getByRole('region', { name: 'Przewijana historia zdarzeń' });
        Object.defineProperty(region, 'scrollTop', { configurable: true, value: 2 });
        const scrollTo = vi.fn();
        Object.defineProperty(region, 'scrollTo', { configurable: true, value: scrollTo });
        vi.stubGlobal('matchMedia', () => ({ matches: true }));

        fireEvent.click(screen.getByRole('button', { name: 'Na górę' }));

        expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    });

    it('shows the top tooltip without refreshing, and dismisses it by Escape, blur, and timeout', () => {
        vi.useFakeTimers();
        render(
            <HistorySidebarContent
                source={source}
                devices={[]}
                realtimeUncertain={false}
                waitingForRoom={false}
            />,
        );

        const button = screen.getByRole('button', { name: 'Na górę' });
        fireEvent.click(button);
        expect(mocks.showNewest).not.toHaveBeenCalled();
        expect(screen.getByRole('tooltip')).toHaveTextContent('Jesteś już na samej górze');
        expect(button).toHaveAttribute('aria-describedby', 'history-top-tooltip');

        fireEvent.keyDown(button, { key: 'Escape' });
        expect(screen.queryByRole('tooltip')).toBeNull();

        fireEvent.click(button);
        fireEvent.blur(button);
        expect(screen.queryByRole('tooltip')).toBeNull();

        fireEvent.click(button);
        act(() => vi.advanceTimersByTime(3000));
        expect(screen.queryByRole('tooltip')).toBeNull();
    });
});
