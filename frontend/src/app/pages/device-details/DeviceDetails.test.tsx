import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockEventSource } from '../../../test/room/mock-event-source';
import {
    createLedDevice,
    createRoomSnapshotMessage,
    createTemperatureDevice,
} from '../../../test/room/room-realtime-fixtures';
import { createAppRoutes } from '../../AppRoutes';

function renderAppAt(initialEntry: string) {
    const router = createMemoryRouter(createAppRoutes(), { initialEntries: [initialEntry] });

    return render(<RouterProvider router={router} />);
}

describe('device details navigation', () => {
    beforeEach(() => {
        MockEventSource.instances.length = 0;
        vi.stubGlobal('EventSource', MockEventSource);
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise(() => undefined)),
        );
    });

    afterEach(() => vi.unstubAllGlobals());

    it('focuses the page heading and resolves a device only after a valid snapshot', async () => {
        renderAppAt('/device-details/temp-desk');

        const heading = screen.getByRole('heading', { name: 'Szczegóły urządzenia', level: 1 });
        await waitFor(() => expect(heading).toHaveFocus());
        expect(screen.queryByText('Nie znaleziono urządzenia o tym identyfikatorze.')).toBeNull();

        act(() =>
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [createTemperatureDevice()] }),
            ),
        );

        expect(
            screen.getByRole('heading', { name: 'Szczegóły urządzenia: Temperatura biurka' }),
        ).toBeInTheDocument();
        expect(screen.getByRole('table', { name: 'Pomiary temperatury' })).toHaveTextContent(
            'Historia pomiarów nie jest jeszcze dostępna.',
        );
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('loads retained LED history only after a snapshot confirms the selected device', async () => {
        const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
        vi.stubGlobal('fetch', fetcher);
        renderAppAt('/device-details/led-main');
        expect(fetcher).not.toHaveBeenCalled();
        act(() =>
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [createLedDevice()] }),
            ),
        );

        expect(
            await screen.findByRole('heading', { name: /Historia zdarzeń urządzenia/ }),
        ).toBeInTheDocument();
        await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
        const requestedUrl = new URL(fetcher.mock.calls[0]?.[0] as string);
        expect(requestedUrl.pathname).toBe('/room/history/user-history');
        expect(requestedUrl.searchParams.get('deviceId')).toBe('led-main');
        expect(requestedUrl.searchParams.get('pageSize')).toBe('50');
    });
    it('reports an unknown device only after receiving its baseline', () => {
        renderAppAt('/device-details/missing-device');
        expect(screen.queryByText('Nie znaleziono urządzenia o tym identyfikatorze.')).toBeNull();
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage({ devices: [] })));
        expect(
            screen.getByText('Nie znaleziono urządzenia o tym identyfikatorze.'),
        ).toBeInTheDocument();
    });

    it('navigates from every device card and leaves only one active room connection', async () => {
        const user = userEvent.setup();
        const router = createMemoryRouter(createAppRoutes(), {
            initialEntries: ['/'],
        });
        render(
            <StrictMode>
                <RouterProvider router={router} />
            </StrictMode>,
        );
        act(() =>
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({
                    devices: [createTemperatureDevice(), createLedDevice()],
                }),
            ),
        );

        expect(
            screen.getByRole('link', { name: 'Szczegóły urządzenia: Główne LED' }),
        ).toHaveAttribute('href', '/device-details/led-main');
        const deviceDetailsLink = screen.getByRole('link', {
            name: 'Szczegóły urządzenia: Temperatura biurka',
        });
        deviceDetailsLink.focus();
        await user.keyboard('{Enter}');
        act(() =>
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({
                    devices: [createTemperatureDevice(), createLedDevice()],
                }),
            ),
        );
        await waitFor(() =>
            expect(
                screen.getByRole('heading', {
                    name: 'Szczegóły urządzenia: Temperatura biurka',
                    level: 1,
                }),
            ).toHaveFocus(),
        );
        expect(MockEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);

        await user.click(screen.getByRole('link', { name: 'Wróć do Dashboardu' }));
        await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
        expect(MockEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);

        await act(async () => router.navigate(-1));
        expect(router.state.location.pathname).toBe('/device-details/temp-desk');
        expect(
            screen.getByRole('heading', { name: 'Szczegóły urządzenia', level: 1 }),
        ).toBeVisible();
        await act(async () => router.navigate(1));
        expect(router.state.location.pathname).toBe('/');
        await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
    });

    it('shows a not-found page for incomplete or unknown URLs', () => {
        renderAppAt('/device-details');

        expect(screen.getByRole('heading', { name: 'Nie znaleziono strony' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Wróć do Dashboardu' })).toHaveAttribute(
            'href',
            '/',
        );
        expect(MockEventSource.instances).toHaveLength(0);
    });
});
