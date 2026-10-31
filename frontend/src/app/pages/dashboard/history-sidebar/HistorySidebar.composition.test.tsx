import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { i18n } from '../../../i18n';

import { HistorySidebarContent } from './history-sidebar-content/HistorySidebarContent';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
it('keeps live history intact while the independent modal searches', async () => {
    const fixture = createUserHistoryFixtures();
    const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
            new Response(
                JSON.stringify({ ...fixture.page, pageSize: 50, items: [], nextCursor: null }),
            ),
        );
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
        this: HTMLDialogElement,
    ) {
        this.setAttribute('open', '');
    });
    const source = {
        subscribe: () => () => undefined,
        getBaseline: () => undefined,
        requestBaseline: vi.fn(),
    };
    render(
        <HistorySidebarContent
            source={source}
            devices={[]}
            waitingForRoom
            realtimeUncertain={false}
        />,
    );
    const live = screen.getByRole('region', {
        name: i18n.t('history.scrollRegion', { ns: 'dashboard' }),
    });
    const before = live.textContent;
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(
        screen.getByRole('button', { name: i18n.t('search', { ns: 'deviceFilters' }) }),
    );
    const search = within(screen.getByRole('dialog'));
    fireEvent.change(search.getByLabelText(i18n.t('from', { ns: 'deviceFilters' })), {
        target: { value: '2026-10-20' },
    });
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(
        search.getByRole('button', { name: i18n.t('search', { ns: 'deviceFilters' }) }),
    );
    expect(await search.findByText(i18n.t('history.noMatches', { ns: 'dashboard' }))).toBeVisible();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(live.textContent).toBe(before);
});
