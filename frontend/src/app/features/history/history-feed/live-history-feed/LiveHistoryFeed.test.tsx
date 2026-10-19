import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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

vi.mock('../live-history-list/LiveHistoryList', () => ({ LiveHistoryList: () => null }));
vi.mock('../useHistory', () => ({
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

import { createRef } from 'react';

import { HistoryProvider } from '../../HistoryProvider';
import type { HistoryFeedHandle } from '../history-feed-handle';

import { LiveHistoryFeed } from './LiveHistoryFeed';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());
it('renders only the feed and exposes navigation without owning sidebar controls', () => {
    const ref = createRef<HistoryFeedHandle>();
    render(
        <HistoryProvider
            mode="live"
            source={source}
            devices={[]}
            realtimeUncertain={false}
            waitingForRoom={false}
        >
            <LiveHistoryFeed ref={ref} />
        </HistoryProvider>,
    );
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const region = screen.getByRole('region');
    const scrollTo = vi.fn();
    Object.defineProperty(region, 'scrollTo', { configurable: true, value: scrollTo });
    expect(ref.current?.scrollToTop()).toEqual({ alreadyAtTop: true });
    expect(mocks.showNewest).not.toHaveBeenCalled();
    Object.defineProperty(region, 'scrollTop', { configurable: true, value: 2 });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    act(() => {
        expect(ref.current?.scrollToTop()).toEqual({ alreadyAtTop: false });
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    expect(mocks.showNewest).toHaveBeenCalledOnce();
});
