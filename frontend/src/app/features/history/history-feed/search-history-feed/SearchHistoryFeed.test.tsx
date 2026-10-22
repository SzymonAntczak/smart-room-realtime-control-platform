import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { i18n } from '../../../../i18n';
import { HistoryFilters } from '../../history-filters/HistoryFilters';
import { HistoryProvider } from '../../HistoryProvider';
import type { HistoryFeedHandle } from '../history-feed-handle';

import { SearchHistoryFeed } from './SearchHistoryFeed';

afterEach(() => vi.unstubAllGlobals());

it('exposes scroll navigation without adding footer controls or refreshing a static query', () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const ref = createRef<HistoryFeedHandle>();
    render(
        <HistoryProvider mode="search" devices={[]}>
            <SearchHistoryFeed ref={ref} />
        </HistoryProvider>,
    );
    const region = screen.getByRole('region');
    const scrollTo = vi.fn();
    Object.defineProperty(region, 'scrollTo', { configurable: true, value: scrollTo });
    expect(ref.current?.scrollToTop()).toEqual({ alreadyAtTop: true });
    Object.defineProperty(region, 'scrollTop', { configurable: true, value: 100 });
    act(() => {
        expect(ref.current?.scrollToTop()).toEqual({ alreadyAtTop: false });
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
});

it('resets its own scroll position for an applied query but leaves it alone during draft edits', async () => {
    const fixture = createUserHistoryFixtures();
    vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation(
            async () =>
                new Response(
                    JSON.stringify({
                        ...fixture.page,
                        pageSize: 50,
                        items: [],
                        nextCursor: null,
                    }),
                ),
        ),
    );
    render(
        <HistoryProvider mode="search" devices={[]}>
            <HistoryFilters />
            <SearchHistoryFeed />
        </HistoryProvider>,
    );
    const region = screen.getByRole('region', {
        name: i18n.t('history.searchResults', { ns: 'dashboard' }),
    });
    const scrollTo = vi.fn();
    Object.defineProperty(region, 'scrollTo', { configurable: true, value: scrollTo });
    fireEvent.change(screen.getByLabelText(i18n.t('history.from', { ns: 'dashboard' })), {
        target: { value: '2026-10-20' },
    });
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.click(
        screen.getByRole('button', { name: i18n.t('history.search', { ns: 'dashboard' }) }),
    );
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' }));
    scrollTo.mockClear();
    fireEvent.change(screen.getByLabelText(i18n.t('history.from', { ns: 'dashboard' })), {
        target: { value: '2026-10-19' },
    });
    expect(scrollTo).not.toHaveBeenCalled();
});
