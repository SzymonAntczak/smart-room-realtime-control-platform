import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRoomHistorySource } from '../realtime/room-history-source';

const mocks = vi.hoisted(() => ({
    loadOlder: vi.fn(),
    retry: vi.fn(),
    showNewest: vi.fn(),
    updateReadingPosition: vi.fn(),
}));
const source = createRoomHistorySource().source;

vi.mock('./RecentEventsFeed', () => ({ RecentEventsFeed: () => null }));
vi.mock('./use-user-history', () => ({
    useUserHistory: () => ({
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

import { UserHistoryPanel } from './UserHistoryPanel';

describe('user history panel controls', () => {
    beforeEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps filter inactive and returns to newest when away from the top', () => {
        render(
            <UserHistoryPanel
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
        fireEvent.click(screen.getByRole('button', { name: 'Na górę' }));
        expect(mocks.showNewest).toHaveBeenCalledOnce();
    });

    it('shows the top tooltip without refreshing, and dismisses it by Escape, blur, and timeout', () => {
        vi.useFakeTimers();
        render(
            <UserHistoryPanel
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
