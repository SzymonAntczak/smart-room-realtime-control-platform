import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
                    Filtruj
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

        fireEvent.click(screen.getByRole('button', { name: 'Filtruj' }));
        const dialog = screen.getByRole('dialog', { name: 'Wyszukaj historię' });
        expect(dialog.tagName).toBe('DIALOG');
        expect(dialog).toHaveAttribute('open');
        expect(fetcher).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent(
            'Wybierz co najmniej jedno kryterium i rozpocznij wyszukiwanie.',
        );
        const reload = screen.getByRole('button', { name: 'Odśwież wyniki' });
        expect(reload).toBeInTheDocument();
        fireEvent.click(reload);
        expect(screen.getByRole('tooltip')).toHaveTextContent(
            'Wybierz filtr i kliknij Szukaj przed odświeżeniem.',
        );
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('tooltip')).toBeNull();
        expect(dialog).toHaveAttribute('open');
        expect(fetcher).not.toHaveBeenCalled();

        const search = screen.getByRole('button', { name: 'Szukaj' });
        fireEvent.blur(screen.getByLabelText('Od'));
        expect(fetcher).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Od'), { target: { value: '2026-03-08' } });
        fireEvent.change(screen.getByLabelText('Do'), { target: { value: '2026-03-08' } });
        fireEvent.blur(screen.getByLabelText('Do'));
        expect(fetcher).not.toHaveBeenCalled();
        fireEvent.click(search);

        await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
        await screen.findByText('Brak zdarzeń spełniających te kryteria.');
        const requestUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
        expect(requestUrl.searchParams.get('from')).toBe(
            new Date(2026, 2, 8).toISOString().replace('.000Z', 'Z'),
        );
        expect(requestUrl.searchParams.get('to')).toBe(
            new Date(2026, 2, 9).toISOString().replace('.000Z', 'Z'),
        );
        expect(screen.getByText(/Zastosowane kryteria: Od: 2026-03-08/)).toBeInTheDocument();
        expect(screen.getByText('Brak zdarzeń spełniających te kryteria.')).toBeInTheDocument();
    });

    it('keeps draft edits separate, starts empty on reopen and clears without a request', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(pageResponse())
            .mockResolvedValueOnce(pageResponse());
        vi.stubGlobal('fetch', fetcher);
        renderSearchModal();
        fireEvent.click(screen.getByRole('button', { name: 'Filtruj' }));
        const from = screen.getByLabelText('Od');

        fireEvent.change(from, { target: { value: '2026-03-08' } });
        fireEvent.blur(from);
        expect(fetcher).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Szukaj' }));
        await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Odśwież wyniki' })).toBeEnabled(),
        );
        fireEvent.blur(from);
        expect(fetcher).toHaveBeenCalledOnce();

        fireEvent.change(from, { target: { value: '2026-03-09' } });
        expect(fetcher).toHaveBeenCalledOnce();
        expect(screen.getByText(/Od: 2026-03-08/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Odśwież wyniki' }));
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
        expect(new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get('from')).toBe(
            new Date(2026, 2, 8).toISOString().replace('.000Z', 'Z'),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Zamknij wyszukiwanie historii' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('button', { name: 'Filtruj' })).toHaveFocus();

        fireEvent.click(screen.getByRole('button', { name: 'Filtruj' }));
        expect(screen.getByLabelText('Od')).toHaveValue('');
        expect(screen.queryByText(/Zastosowane kryteria/)).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(2);

        const clear = screen.getByRole('button', { name: 'Wyczyść filtry' });
        fireEvent.click(clear);
        expect(screen.getByLabelText('Od')).toHaveValue('');
        expect(screen.getByRole('status')).toHaveTextContent(
            'Wybierz co najmniej jedno kryterium i rozpocznij wyszukiwanie.',
        );
        expect(fetcher).toHaveBeenCalledTimes(2);

        await act(async () => Promise.resolve());
    });

    it('refreshes applied criteria when the draft has changed', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(pageResponse());
        vi.stubGlobal('fetch', fetcher);
        renderSearchModal();
        fireEvent.click(screen.getByRole('button', { name: 'Filtruj' }));

        const from = screen.getByLabelText('Od');
        fireEvent.change(from, { target: { value: '2026-03-08' } });
        fireEvent.blur(from);
        expect(fetcher).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Szukaj' }));
        await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Odśwież wyniki' })).toBeEnabled(),
        );

        fireEvent.change(from, { target: { value: '2026-03-09' } });
        const refresh = screen.getByRole('button', { name: 'Odśwież wyniki' });
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
        fireEvent.click(screen.getByRole('button', { name: 'Filtruj' }));
        fireEvent.change(screen.getByLabelText('Od'), { target: { value: '2026-03-10' } });
        fireEvent.change(screen.getByLabelText('Do'), { target: { value: '2026-03-09' } });
        fireEvent.blur(screen.getByLabelText('Do'));
        expect(screen.queryByRole('alert')).toBeNull();
        expect(fetcher).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Szukaj' }));

        expect(screen.getByRole('alert')).toHaveTextContent(
            'Data początkowa nie może być późniejsza niż końcowa.',
        );
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('closes through the native dialog close cycle when its backdrop is clicked', () => {
        renderSearchModal();
        fireEvent.click(screen.getByRole('button', { name: 'Filtruj' }));
        const dialog = screen.getByRole('dialog', { name: 'Wyszukaj historię' });
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
        expect(screen.getByRole('button', { name: 'Filtruj' })).toHaveFocus();
    });
});
