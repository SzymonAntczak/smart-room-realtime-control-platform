import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../../../i18n';

import { HistorySearchModal } from './HistorySearchModal';

const fixtures = createUserHistoryFixtures();
const nativeDialog = {
    showModal: HTMLDialogElement.prototype.showModal,
    close: HTMLDialogElement.prototype.close,
};
const restoreFocus = new WeakMap<HTMLDialogElement, HTMLElement | null>();

beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
        restoreFocus.set(
            this,
            document.activeElement instanceof HTMLElement ? document.activeElement : null,
        );
        this.setAttribute('open', '');
        this.querySelector<HTMLElement>('[autofocus]')?.focus();
    };

    HTMLDialogElement.prototype.close = function close() {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
        restoreFocus.get(this)?.focus();
    };
});

afterAll(() => {
    HTMLDialogElement.prototype.showModal = nativeDialog.showModal;
    HTMLDialogElement.prototype.close = nativeDialog.close;
});

function renderSearchModal() {
    function SearchHarness() {
        const [open, setOpen] = useState(false);

        return (
            <>
                <button
                    type="button"
                    onClick={(event) => {
                        event.currentTarget.focus();
                        setOpen(true);
                    }}
                >
                    {i18n.t('history.filter', { ns: 'dashboard' })}
                </button>
                <HistorySearchModal open={open} onClose={() => setOpen(false)} devices={[]} />
            </>
        );
    }

    return render(<SearchHarness />);
}

function pageResponse(nextCursor: string | null = null) {
    return new Response(JSON.stringify({ ...fixtures.page, items: [], pageSize: 50, nextCursor }));
}

describe('HistorySearchModal', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('waits for submit before searching changed filters and renders the initial instruction', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(pageResponse());
        vi.stubGlobal('fetch', fetcher);
        renderSearchModal();

        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('history.filter', { ns: 'dashboard' }) }),
        );
        const dialog = screen.getByRole('dialog', {
            name: i18n.t('history.searchTitle', { ns: 'dashboard' }),
        });
        expect(dialog.tagName).toBe('DIALOG');
        expect(dialog).toHaveAttribute('open');
        expect(fetcher).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent(
            i18n.t('history.searchInstruction', { ns: 'dashboard' }),
        );
        const reload = screen.getByRole('button', {
            name: i18n.t('refresh', { ns: 'deviceFilters' }),
        });
        expect(reload).toBeInTheDocument();
        fireEvent.click(reload);
        expect(screen.getByRole('tooltip')).toHaveTextContent(
            i18n.t('searchFilterRequired', { ns: 'deviceFilters' }),
        );
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('tooltip')).toBeNull();
        expect(dialog).toHaveAttribute('open');
        expect(fetcher).not.toHaveBeenCalled();

        const search = screen.getByRole('button', {
            name: i18n.t('search', { ns: 'deviceFilters' }),
        });
        fireEvent.blur(screen.getByLabelText(i18n.t('from', { ns: 'deviceFilters' })));
        expect(fetcher).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText(i18n.t('from', { ns: 'deviceFilters' })), {
            target: { value: '2026-03-08' },
        });
        fireEvent.change(screen.getByLabelText(i18n.t('to', { ns: 'deviceFilters' })), {
            target: { value: '2026-03-08' },
        });
        fireEvent.blur(screen.getByLabelText(i18n.t('to', { ns: 'deviceFilters' })));
        expect(fetcher).not.toHaveBeenCalled();
        fireEvent.click(search);

        await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
        await screen.findByText(i18n.t('history.noMatches', { ns: 'dashboard' }));
        const requestUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
        expect(requestUrl.searchParams.get('from')).toBe(
            new Date(2026, 2, 8).toISOString().replace('.000Z', 'Z'),
        );
        expect(requestUrl.searchParams.get('to')).toBe(
            new Date(2026, 2, 9).toISOString().replace('.000Z', 'Z'),
        );
        expect(
            screen.getByText(
                `${i18n.t('appliedCriteria', { ns: 'deviceFilters' })}: ${i18n.t('from', { ns: 'deviceFilters' })}: 2026-03-08`,
                { exact: false },
            ),
        ).toBeInTheDocument();
        expect(
            screen.getByText(i18n.t('history.noMatches', { ns: 'dashboard' })),
        ).toBeInTheDocument();
    });

    it('keeps draft edits separate, starts empty on reopen and clears without a request', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(pageResponse())
            .mockResolvedValueOnce(pageResponse());
        vi.stubGlobal('fetch', fetcher);
        renderSearchModal();
        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('history.filter', { ns: 'dashboard' }) }),
        );
        const from = screen.getByLabelText(i18n.t('from', { ns: 'deviceFilters' }));

        fireEvent.change(from, { target: { value: '2026-03-08' } });
        fireEvent.blur(from);
        expect(fetcher).not.toHaveBeenCalled();
        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('search', { ns: 'deviceFilters' }) }),
        );
        await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
        await waitFor(() =>
            expect(
                screen.getByRole('button', {
                    name: i18n.t('refresh', { ns: 'deviceFilters' }),
                }),
            ).toBeEnabled(),
        );
        fireEvent.blur(from);
        expect(fetcher).toHaveBeenCalledOnce();

        fireEvent.change(from, { target: { value: '2026-03-09' } });
        expect(fetcher).toHaveBeenCalledOnce();
        expect(
            screen.getByText(`${i18n.t('from', { ns: 'deviceFilters' })}: 2026-03-08`, {
                exact: false,
            }),
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('refresh', { ns: 'deviceFilters' }) }),
        );
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
        expect(new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get('from')).toBe(
            new Date(2026, 2, 8).toISOString().replace('.000Z', 'Z'),
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: i18n.t('history.closeSearch', { ns: 'dashboard' }),
            }),
        );
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(
            screen.getByRole('button', { name: i18n.t('history.filter', { ns: 'dashboard' }) }),
        ).toHaveFocus();

        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('history.filter', { ns: 'dashboard' }) }),
        );
        expect(screen.getByLabelText(i18n.t('from', { ns: 'deviceFilters' }))).toHaveValue('');
        expect(
            screen.queryByText(i18n.t('appliedCriteria', { ns: 'deviceFilters' }), {
                exact: false,
            }),
        ).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(2);

        const clear = screen.getByRole('button', {
            name: i18n.t('clearFilters', { ns: 'deviceFilters' }),
        });
        fireEvent.click(clear);
        expect(screen.getByLabelText(i18n.t('from', { ns: 'deviceFilters' }))).toHaveValue('');
        expect(screen.getByRole('status')).toHaveTextContent(
            i18n.t('history.searchInstruction', { ns: 'dashboard' }),
        );
        expect(fetcher).toHaveBeenCalledTimes(2);

        await act(async () => Promise.resolve());
    });

    it('refreshes applied criteria when the draft has changed', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(pageResponse());
        vi.stubGlobal('fetch', fetcher);
        renderSearchModal();
        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('history.filter', { ns: 'dashboard' }) }),
        );

        const from = screen.getByLabelText(i18n.t('from', { ns: 'deviceFilters' }));
        fireEvent.change(from, { target: { value: '2026-03-08' } });
        fireEvent.blur(from);
        expect(fetcher).not.toHaveBeenCalled();
        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('search', { ns: 'deviceFilters' }) }),
        );
        await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
        await waitFor(() =>
            expect(
                screen.getByRole('button', {
                    name: i18n.t('refresh', { ns: 'deviceFilters' }),
                }),
            ).toBeEnabled(),
        );

        fireEvent.change(from, { target: { value: '2026-03-09' } });
        const refresh = screen.getByRole('button', {
            name: i18n.t('refresh', { ns: 'deviceFilters' }),
        });
        fireEvent.click(refresh);
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

        expect(new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get('from')).toBe(
            new Date(2026, 2, 8).toISOString().replace('.000Z', 'Z'),
        );
    });

    it('rejects a reversed date range on submit without starting a search', () => {
        const fetcher = vi.fn<typeof fetch>();
        vi.stubGlobal('fetch', fetcher);
        renderSearchModal();
        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('history.filter', { ns: 'dashboard' }) }),
        );
        fireEvent.change(screen.getByLabelText(i18n.t('from', { ns: 'deviceFilters' })), {
            target: { value: '2026-03-10' },
        });
        fireEvent.change(screen.getByLabelText(i18n.t('to', { ns: 'deviceFilters' })), {
            target: { value: '2026-03-09' },
        });
        fireEvent.blur(screen.getByLabelText(i18n.t('to', { ns: 'deviceFilters' })));
        expect(screen.queryByRole('alert')).toBeNull();
        expect(fetcher).not.toHaveBeenCalled();
        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('search', { ns: 'deviceFilters' }) }),
        );

        expect(screen.getByRole('alert')).toHaveTextContent(
            i18n.t('invalidDateRange', { ns: 'deviceFilters' }),
        );
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('closes through the native dialog close cycle when its backdrop is clicked', () => {
        renderSearchModal();
        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('history.filter', { ns: 'dashboard' }) }),
        );
        const dialog = screen.getByRole('dialog', {
            name: i18n.t('history.searchTitle', { ns: 'dashboard' }),
        });
        vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
            x: 100,
            y: 100,
            top: 100,
            left: 100,
            right: 500,
            bottom: 500,
            width: 400,
            height: 400,
            toJSON: () => ({}),
        });

        fireEvent.click(dialog, { clientX: 50, clientY: 150 });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(
            screen.getByRole('button', { name: i18n.t('history.filter', { ns: 'dashboard' }) }),
        ).toHaveFocus();
    });

    it('returns to the top for a submitted query while draft edits preserve scroll', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockImplementation(async () => pageResponse()),
        );
        renderSearchModal();
        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('history.filter', { ns: 'dashboard' }) }),
        );
        const region = screen.getByRole('region', {
            name: i18n.t('history.searchResults', { ns: 'dashboard' }),
        });
        const scrollTo = vi.fn();
        Object.defineProperty(region, 'scrollTo', { configurable: true, value: scrollTo });
        fireEvent.change(screen.getByLabelText(i18n.t('from', { ns: 'deviceFilters' })), {
            target: { value: '2026-10-20' },
        });
        expect(scrollTo).not.toHaveBeenCalled();
        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('search', { ns: 'deviceFilters' }) }),
        );
        await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' }));
        scrollTo.mockClear();
        fireEvent.change(screen.getByLabelText(i18n.t('from', { ns: 'deviceFilters' })), {
            target: { value: '2026-10-19' },
        });
        expect(scrollTo).not.toHaveBeenCalled();
    });
});
