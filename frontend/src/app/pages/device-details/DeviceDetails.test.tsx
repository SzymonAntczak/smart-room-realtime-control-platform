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
import { i18n } from '../../i18n';

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

    it('shows sensor telemetry and starts its history only after a valid snapshot', async () => {
        renderAppAt('/device-details/temp-desk');

        const heading = screen.getByRole('heading', {
            name: i18n.t('heading', { ns: 'deviceDetails' }),
            level: 1,
        });
        await waitFor(() => expect(heading).toHaveFocus());
        expect(screen.queryByText(i18n.t('notFound', { ns: 'deviceDetails' }))).toBeNull();
        expect(globalThis.fetch).not.toHaveBeenCalled();

        act(() =>
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [createTemperatureDevice()] }),
            ),
        );

        expect(
            screen.getByRole('heading', {
                name: i18n.t('title', {
                    ns: 'deviceDetails',
                    name: i18n.t('devices.temperatureDesk', { ns: 'dashboard' }),
                }),
            }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('table', { name: i18n.t('table.caption', { ns: 'deviceDetails' }) }),
        ).toHaveTextContent(i18n.t('historyUnavailable', { ns: 'deviceDetails' }));
        expect(
            screen.getByRole('img', { name: i18n.t('chart.title', { ns: 'deviceDetails' }) }),
        ).toHaveAccessibleDescription(i18n.t('chart.empty', { ns: 'deviceDetails' }));
        expect(
            screen.getByRole('heading', {
                name: i18n.t('eventHistory.title', { ns: 'deviceDetails' }),
            }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
        const request = vi.mocked(globalThis.fetch).mock.calls[0];
        const requestedUrl = new URL(String(request?.[0]));
        expect(requestedUrl.pathname).toBe('/room/history/user-history');
        expect(requestedUrl.searchParams.get('deviceId')).toBe('temp-desk');
        expect(requestedUrl.searchParams.get('pageSize')).toBe('50');
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
            await screen.findByRole('heading', {
                name: i18n.t('eventHistory.title', { ns: 'deviceDetails' }),
            }),
        ).toBeInTheDocument();
        await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
        const requestedUrl = new URL(fetcher.mock.calls[0]?.[0] as string);
        expect(requestedUrl.pathname).toBe('/room/history/user-history');
        expect(requestedUrl.searchParams.get('deviceId')).toBe('led-main');
        expect(requestedUrl.searchParams.get('pageSize')).toBe('50');
        expect(
            screen.queryByRole('img', { name: i18n.t('chart.title', { ns: 'deviceDetails' }) }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole('table', { name: i18n.t('table.caption', { ns: 'deviceDetails' }) }),
        ).not.toBeInTheDocument();
    });
    it('reports an unknown device only after receiving its baseline', () => {
        renderAppAt('/device-details/missing-device');
        expect(screen.queryByText(i18n.t('notFound', { ns: 'deviceDetails' }))).toBeNull();
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage({ devices: [] })));
        expect(screen.getByText(i18n.t('notFound', { ns: 'deviceDetails' }))).toBeInTheDocument();
        expect(globalThis.fetch).not.toHaveBeenCalled();
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
            screen.getByRole('link', {
                name: i18n.t('open', {
                    ns: 'deviceDetails',
                    name: i18n.t('devices.ledMain', { ns: 'dashboard' }),
                }),
            }),
        ).toHaveAttribute('href', '/device-details/led-main');
        const deviceDetailsLink = screen.getByRole('link', {
            name: i18n.t('open', {
                ns: 'deviceDetails',
                name: i18n.t('devices.temperatureDesk', { ns: 'dashboard' }),
            }),
        });
        const establishedSource = MockEventSource.latest();
        const establishedCount = MockEventSource.instances.length;
        deviceDetailsLink.focus();
        await user.keyboard('{Enter}');
        await waitFor(() =>
            expect(
                screen.getByRole('heading', {
                    name: i18n.t('title', {
                        ns: 'deviceDetails',
                        name: i18n.t('devices.temperatureDesk', { ns: 'dashboard' }),
                    }),
                    level: 1,
                }),
            ).toHaveFocus(),
        );
        expect(MockEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);

        expect(MockEventSource.latest()).toBe(establishedSource);
        expect(MockEventSource.instances).toHaveLength(establishedCount);
        await user.click(
            screen.getByRole('link', { name: i18n.t('back', { ns: 'deviceDetails' }) }),
        );
        await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
        expect(MockEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);

        await act(async () => router.navigate(-1));
        expect(router.state.location.pathname).toBe('/device-details/temp-desk');
        expect(MockEventSource.latest()).toBe(establishedSource);
        expect(MockEventSource.instances).toHaveLength(establishedCount);
        expect(
            screen.getByRole('heading', {
                name: i18n.t('title', {
                    ns: 'deviceDetails',
                    name: i18n.t('devices.temperatureDesk', { ns: 'dashboard' }),
                }),
                level: 1,
            }),
        ).toBeVisible();
        await act(async () => router.navigate(1));
        expect(router.state.location.pathname).toBe('/');
        await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
        await act(async () => router.navigate('/unknown-route'));
        expect(establishedSource.closed).toBe(true);
        expect(MockEventSource.instances).toHaveLength(establishedCount);
    });

    it('shows a not-found page for incomplete or unknown URLs', () => {
        renderAppAt('/device-details');

        expect(
            screen.getByRole('heading', { name: i18n.t('pageNotFound', { ns: 'deviceDetails' }) }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('link', { name: i18n.t('back', { ns: 'deviceDetails' }) }),
        ).toHaveAttribute('href', '/');
        expect(MockEventSource.instances).toHaveLength(0);
    });
});
