import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../../i18n';
import { HistoryProvider } from '../HistoryProvider';

import { HistoryFilters } from './HistoryFilters';

const device = { deviceId: 'led-main', name: 'LED' };
const fixture = createUserHistoryFixtures();

function response() {
    return new Response(
        JSON.stringify({ ...fixture.page, items: [], pageSize: 50, nextCursor: null }),
    );
}

function view(name = 'LED', deviceId = 'led-main') {
    const selected = { deviceId, name };

    return (
        <HistoryProvider key={deviceId} mode="search" devices={[selected]}>
            <HistoryFilters device={selected} />
        </HistoryProvider>
    );
}

describe('fixed-device history filters', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('starts a device-only query, submits dates, refreshes applied criteria and clears dates', async () => {
        const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
        vi.stubGlobal('fetch', fetcher);
        render(view());
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        expect(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get('deviceId')).toBe(
            device.deviceId,
        );

        fireEvent.change(screen.getByLabelText(i18n.t('history.from', { ns: 'dashboard' })), {
            target: { value: '2026-10-20' },
        });
        expect(fetcher).toHaveBeenCalledTimes(1);
        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('history.search', { ns: 'dashboard' }) }),
        );
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
        const applied = new URL(String(fetcher.mock.calls[1]?.[0])).searchParams;
        expect(applied.get('deviceId')).toBe(device.deviceId);
        expect(applied.get('from')).toBe(new Date(2026, 9, 20).toISOString().replace('.000Z', 'Z'));
        fireEvent.change(screen.getByLabelText(i18n.t('history.from', { ns: 'dashboard' })), {
            target: { value: '2026-10-19' },
        });
        fireEvent.click(
            screen.getByRole('button', { name: i18n.t('history.refresh', { ns: 'dashboard' }) }),
        );
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
        expect(new URL(String(fetcher.mock.calls[2]?.[0])).searchParams.get('from')).toBe(
            applied.get('from'),
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: i18n.t('history.clearFilters', { ns: 'dashboard' }),
            }),
        );
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
        const cleared = new URL(String(fetcher.mock.calls[3]?.[0])).searchParams;
        expect(cleared.get('deviceId')).toBe(device.deviceId);
        expect(cleared.has('from')).toBe(false);
        expect(cleared.has('to')).toBe(false);
        expect(screen.getByLabelText(i18n.t('history.from', { ns: 'dashboard' }))).toHaveValue('');
    });

    it('retains the session through renaming and aborts it on device identity replacement or unmount', async () => {
        const signals: AbortSignal[] = [];
        const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
            if (init?.signal) {
                signals.push(init.signal);
            }

            return new Promise(() => undefined);
        });
        vi.stubGlobal('fetch', fetcher);
        const { rerender, unmount } = render(view());
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        rerender(view('Renamed LED'));
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(signals[0]?.aborted).toBe(false);
        rerender(view('Other LED', 'led-other'));
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
        expect(signals[0]?.aborted).toBe(true);
        expect(new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get('deviceId')).toBe(
            'led-other',
        );
        unmount();
        expect(signals[1]?.aborted).toBe(true);
    });

    it('closes the discarded StrictMode query and keeps the replacement query active', async () => {
        const signals: AbortSignal[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockImplementation((_url, init) => {
                if (init?.signal) {
                    signals.push(init.signal);
                }

                return new Promise(() => undefined);
            }),
        );
        const { unmount } = render(<StrictMode>{view()}</StrictMode>);
        await waitFor(() => expect(signals).toHaveLength(2));
        expect(signals[0]?.aborted).toBe(true);
        expect(signals[1]?.aborted).toBe(false);
        act(() => unmount());
        expect(signals.every((signal) => signal.aborted)).toBe(true);
    });
});
