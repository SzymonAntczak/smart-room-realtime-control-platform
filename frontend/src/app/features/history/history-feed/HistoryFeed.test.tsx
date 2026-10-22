import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { i18n } from '../../../i18n';
import { HistoryFilters } from '../history-filters/HistoryFilters';
import { HistoryProvider } from '../HistoryProvider';

import { HistoryFeed } from './HistoryFeed';

afterEach(() => vi.unstubAllGlobals());

it('keeps a live feed intact while a sibling search feed loads its own results', async () => {
    const fixture = createUserHistoryFixtures();
    const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
            new Response(
                JSON.stringify({ ...fixture.page, pageSize: 50, items: [], nextCursor: null }),
            ),
        );
    vi.stubGlobal('fetch', fetcher);
    const source = {
        subscribe: () => () => undefined,
        getBaseline: () => undefined,
        requestBaseline: vi.fn(),
    };
    render(
        <>
            <section aria-label="Live">
                <HistoryProvider
                    mode="live"
                    source={source}
                    devices={[]}
                    waitingForRoom
                    realtimeUncertain={false}
                >
                    <HistoryFeed />
                </HistoryProvider>
            </section>
            <section aria-label="Search">
                <HistoryProvider mode="search" devices={[]}>
                    <HistoryFilters />
                    <HistoryFeed />
                </HistoryProvider>
            </section>
        </>,
    );
    const live = within(screen.getByRole('region', { name: 'Live' }));
    const search = within(screen.getByRole('region', { name: 'Search' }));
    expect(live.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(live.queryByRole('button')).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
    const before = live.getByRole('status').textContent;
    fireEvent.change(search.getByLabelText(i18n.t('history.from', { ns: 'dashboard' })), {
        target: { value: '2026-10-20' },
    });
    fireEvent.click(
        search.getByRole('button', { name: i18n.t('history.search', { ns: 'dashboard' }) }),
    );
    expect(await search.findByText(i18n.t('history.noMatches', { ns: 'dashboard' }))).toBeVisible();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(live.getByRole('status').textContent).toBe(before);
});
