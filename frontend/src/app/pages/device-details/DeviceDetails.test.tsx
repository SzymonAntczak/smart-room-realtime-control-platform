import { isRawTelemetryPage, type RawTelemetryPage } from '@smart-room/contracts/history';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import {
    isRoomBffRealtimeServerMessage,
    type RoomBffRealtimeServerMessage,
} from '@smart-room/contracts/room-bff';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockEventSource } from '../../../test/room/mock-event-source';
import {
    createLedDevice,
    createRoomSnapshotMessage,
    createTemperatureDevice,
} from '../../../test/room/room-realtime-fixtures';
import { createAppRoutes } from '../../AppRoutes';
import { formatTimestamp } from '../../features/date-time';
import { i18n } from '../../i18n';

async function renderAppAt(initialEntry: string) {
    const router = createMemoryRouter(createAppRoutes(), { initialEntries: [initialEntry] });

    const view = render(<RouterProvider router={router} />);
    await act(async () => vi.dynamicImportSettled());
    await screen.findByRole('main');

    return view;
}

function makeTelemetryPage(
    first: number,
    count: number,
    nextCursor: string | null,
): RawTelemetryPage {
    const fixture = createHistoryIdentityFixtures();
    const page = {
        ...fixture.rawTelemetryPage,
        historyGenerationId: 'generation-test',
        pageSize: 100,
        throughSequence: 1000,
        items: Array.from({ length: count }, (_, index) => ({
            ...fixture.telemetrySample,
            storageSequence: first - index,
            value: first - index + 0.125,
            recordId: `rec:v1:sha256:${(1000 - first + index).toString(16).padStart(64, '0')}`,
        })),
        nextCursor,
    };
    expect(isRawTelemetryPage(page)).toBe(true);

    return page;
}

describe('device details navigation', () => {
    beforeAll(async () => {
        await Promise.all([import('./DeviceDetails'), import('../dashboard/Dashboard')]);
    });

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-11T00:00:00.000Z'));
        MockEventSource.instances.length = 0;
        vi.stubGlobal('EventSource', MockEventSource);
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise(() => undefined)),
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('shows sensor telemetry and starts its history only after a valid snapshot', async () => {
        await renderAppAt('/device-details/temp-desk');

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
        ).toHaveTextContent(i18n.t('telemetry.loading', { ns: 'deviceDetails' }));
        expect(
            screen.getByRole('application', {
                name: i18n.t('chart.title', { ns: 'deviceDetails' }),
            }),
        ).toHaveAccessibleDescription(i18n.t('chart.empty', { ns: 'deviceDetails' }));
        expect(
            screen.getByRole('heading', {
                name: i18n.t('eventHistory.title', { ns: 'deviceDetails' }),
            }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
        const calls = vi.mocked(globalThis.fetch).mock.calls;
        const telemetryRequest = calls.find(
            ([input]) => new URL(String(input)).pathname === '/room/history/telemetry',
        );
        const telemetryUrl = new URL(String(telemetryRequest?.[0]));
        expect(telemetryUrl.searchParams.get('deviceId')).toBe('temp-desk');
        expect(telemetryUrl.searchParams.get('pageSize')).toBe('100');
        const request = calls.find(
            ([input]) => new URL(String(input)).pathname === '/room/history/user-history',
        );
        const requestedUrl = new URL(String(request?.[0]));
        expect(requestedUrl.pathname).toBe('/room/history/user-history');
        expect(requestedUrl.searchParams.get('deviceId')).toBe('temp-desk');
        expect(requestedUrl.searchParams.get('pageSize')).toBe('50');
    });

    it('renders the same raw measurements from two HTTP pages in the chart and table', async () => {
        const first = makeTelemetryPage(300, 100, 'older');
        const second = makeTelemetryPage(200, 2, null);
        const fetcher = vi.fn<typeof fetch>((input) => {
            const url = new URL(String(input));

            if (url.pathname !== '/room/history/telemetry') {
                return new Promise(() => undefined);
            }

            return Promise.resolve(
                new Response(JSON.stringify(url.searchParams.has('cursor') ? second : first)),
            );
        });
        vi.stubGlobal('fetch', fetcher);
        await renderAppAt('/device-details/temp-desk');
        act(() =>
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [createTemperatureDevice()] }),
            ),
        );
        await screen.findByText(i18n.t('telemetry.count', { ns: 'deviceDetails', count: 102 }));
        const table = screen.getByRole('table', {
            name: i18n.t('table.caption', { ns: 'deviceDetails' }),
        });
        const chart = screen.getByRole('application', {
            name: i18n.t('chart.title', { ns: 'deviceDetails' }),
        });
        const rows = within(table).getAllByRole('row');
        expect(rows).toHaveLength(103);

        const displayedValues = within(table)
            .getAllByRole('cell')
            .filter((_, index) => index % 4 === 1)
            .map((cell) => cell.textContent);
        expect(displayedValues).toEqual(
            Array.from({ length: 102 }, (_, index) => String(300 - index + 0.125)),
        );
        expect(chart).toHaveAccessibleDescription(
            i18n.t('chart.description', {
                ns: 'deviceDetails',
                unit: i18n.t('temperatureUnit', { ns: 'deviceDetails' }),
                points: [...first.items, ...second.items]
                    .map((sample) => `${formatTimestamp(sample.occurredAt)}: ${sample.value}`)
                    .join('; '),
            }),
        );

        expect(rows[1]).toHaveTextContent('300.125');
        expect(rows.at(-1)).toHaveTextContent('199.125');
        expect(
            screen.getByText(i18n.t('telemetry.baseline', { ns: 'deviceDetails' })),
        ).toBeInTheDocument();
        expect(
            screen.getByText(i18n.t('history.loading', { ns: 'dashboard' })),
        ).toBeInTheDocument();
    });

    it.each(['limit', 'partial'] as const)(
        'labels a %s baseline without presenting it as empty',
        async (outcome) => {
            const first = makeTelemetryPage(300, 100, 'older');
            const second = makeTelemetryPage(200, 100, 'outside-view');
            const fetcher = vi.fn<typeof fetch>((input) => {
                const url = new URL(String(input));

                if (url.pathname !== '/room/history/telemetry') {
                    return new Promise(() => undefined);
                }

                if (!url.searchParams.has('cursor')) {
                    return Promise.resolve(new Response(JSON.stringify(first)));
                }

                return Promise.resolve(
                    outcome === 'limit'
                        ? new Response(JSON.stringify(second))
                        : new Response(
                              JSON.stringify({
                                  error: 'durable_history_unavailable',
                                  message: 'Unavailable',
                              }),
                              { status: 503 },
                          ),
                );
            });
            vi.stubGlobal('fetch', fetcher);
            await renderAppAt('/device-details/temp-desk');
            act(() =>
                MockEventSource.latest().emitMessage(
                    createRoomSnapshotMessage({ devices: [createTemperatureDevice()] }),
                ),
            );
            await screen.findByText(i18n.t(`telemetry.${outcome}`, { ns: 'deviceDetails' }));
            const table = screen.getByRole('table');
            expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(
                outcome === 'limit' ? 201 : 101,
            );
            expect(table).not.toHaveTextContent(i18n.t('telemetry.empty', { ns: 'deviceDetails' }));
            expect(
                fetcher.mock.calls.filter(
                    ([input]) => new URL(String(input)).pathname === '/room/history/telemetry',
                ),
            ).toHaveLength(2);

            if (outcome === 'limit') {
                const sample = {
                    recordId: `rec:v1:sha256:${'f'.repeat(64)}`,
                    deviceId: 'temp-desk',
                    metric: 'temperature',
                    unit: 'celsius',
                    value: 25.25,
                    occurredAt: '2026-09-11T00:00:01.000Z',
                    durability: 'volatile',
                } as const;
                const message = {
                    messageType: 'device.updated',
                    previousRevision: 0,
                    revision: 1,
                    sentAt: sample.occurredAt,
                    payload: createTemperatureDevice(),
                    telemetrySample: sample,
                } as const;
                expect(isRoomBffRealtimeServerMessage(message)).toBe(true);
                act(() => MockEventSource.latest().emitMessage(message));
                expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(201);
                expect(table).not.toHaveTextContent('300.125');
                expect(
                    within(table)
                        .getAllByRole('cell', { hidden: true })
                        .filter((_, index) => index % 4 === 1)
                        .map((cell) => cell.textContent),
                ).toEqual([
                    ...[...first.items, ...second.items].slice(1).map((item) => String(item.value)),
                    '25.25',
                ]);
                expect(
                    screen.getByRole('application', {
                        name: i18n.t('chart.title', { ns: 'deviceDetails' }),
                    }),
                ).toHaveAccessibleDescription(
                    i18n.t('chart.description', {
                        ns: 'deviceDetails',
                        unit: i18n.t('temperatureUnit', { ns: 'deviceDetails' }),
                        points: [
                            ...[...first.items, ...second.items]
                                .slice(1)
                                .map(
                                    (item) => `${formatTimestamp(item.occurredAt)}: ${item.value}`,
                                ),
                            `${formatTimestamp(sample.occurredAt)}: ${sample.value} (${i18n.t('telemetry.durability.volatile', { ns: 'deviceDetails' })})`,
                        ].join('; '),
                    }),
                );
            }

            if (outcome === 'partial') {
                expect(
                    screen.getByRole('button', {
                        name: i18n.t('telemetry.retry', { ns: 'deviceDetails' }),
                    }),
                ).toBeInTheDocument();
            }
        },
    );

    it('updates the equivalent chart and table through the shared stream and labels live data while HTTP is unavailable', async () => {
        let resolvePage: (response: Response) => void = () => undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>((input) => {
                if (new URL(String(input)).pathname !== '/room/history/telemetry') {
                    return new Promise(() => undefined);
                }

                return new Promise((resolve) => {
                    resolvePage = resolve;
                });
            }),
        );
        await renderAppAt('/device-details/temp-desk');
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));
        const establishedCount = MockEventSource.instances.length;
        const device = createTemperatureDevice();
        const fixture = createHistoryIdentityFixtures().telemetrySample;
        const durable = {
            ...fixture,
            recordId: `rec:v1:sha256:${'c'.repeat(64)}`,
            value: 23.25,
            storageSequence: 1001,
            occurredAt: '2026-09-11T00:00:01.000Z',
        } as const;
        const volatile = {
            recordId: `rec:v1:sha256:${'d'.repeat(64)}`,
            deviceId: fixture.deviceId,
            metric: fixture.metric,
            value: 24.75,
            unit: fixture.unit,
            occurredAt: '2026-09-11T00:00:02.000Z',
            durability: 'volatile',
        } as const;

        const publish = (message: RoomBffRealtimeServerMessage) => {
            expect(isRoomBffRealtimeServerMessage(message)).toBe(true);
            MockEventSource.latest().emitMessage(message);
        };

        act(() => {
            publish({
                messageType: 'device.updated',
                previousRevision: 0,
                revision: 1,
                sentAt: durable.occurredAt,
                payload: device,
                telemetrySample: durable,
            });
            publish({
                messageType: 'device.updated',
                previousRevision: 1,
                revision: 2,
                sentAt: volatile.occurredAt,
                payload: device,
                telemetrySample: volatile,
            });
        });
        await act(async () =>
            resolvePage(
                new Response(
                    JSON.stringify({
                        error: 'durable_history_unavailable',
                        message: 'Unavailable',
                    }),
                    { status: 503 },
                ),
            ),
        );
        const table = screen.getByRole('table', {
            name: i18n.t('table.caption', { ns: 'deviceDetails' }),
        });
        const chart = screen.getByRole('application', {
            name: i18n.t('chart.title', { ns: 'deviceDetails' }),
        });
        expect(within(table).getAllByRole('row')).toHaveLength(3);
        expect(within(table).getByRole('cell', { name: '23.25' })).toBeInTheDocument();
        expect(within(table).getByRole('cell', { name: '24.75' })).toBeInTheDocument();
        expect(
            within(table).getByRole('cell', {
                name: i18n.t('telemetry.durability.volatile', { ns: 'deviceDetails' }),
            }),
        ).toBeInTheDocument();
        expect(chart).toHaveAccessibleDescription(
            i18n.t('chart.description', {
                ns: 'deviceDetails',
                unit: i18n.t('temperatureUnit', { ns: 'deviceDetails' }),
                points: `${formatTimestamp(durable.occurredAt)}: 23.25; ${formatTimestamp(volatile.occurredAt)}: 24.75 (${i18n.t('telemetry.durability.volatile', { ns: 'deviceDetails' })})`,
            }),
        );
        expect(
            screen.getByText(i18n.t('telemetry.errors.unavailable', { ns: 'deviceDetails' })),
        ).toBeInTheDocument();
        expect(
            screen.getByText(i18n.t('telemetry.partial', { ns: 'deviceDetails' })),
        ).toBeInTheDocument();
        expect(
            screen.getByText(i18n.t('telemetry.baseline', { ns: 'deviceDetails' })),
        ).toBeInTheDocument();
        expect(MockEventSource.instances).toHaveLength(establishedCount);
        expect(MockEventSource.instances.filter((connection) => !connection.closed)).toHaveLength(
            1,
        );
    });

    it('distinguishes an empty HTTP result from an unavailable history and supports explicit retry', async () => {
        const empty = {
            ...createHistoryIdentityFixtures().rawTelemetryPage,
            historyGenerationId: 'generation-test',
            pageSize: 100,
            items: [],
        };
        expect(isRawTelemetryPage(empty)).toBe(true);
        let fail = true;
        const fetcher = vi.fn<typeof fetch>((input) => {
            if (new URL(String(input)).pathname !== '/room/history/telemetry') {
                return new Promise(() => undefined);
            }

            return Promise.resolve(
                fail
                    ? new Response(
                          JSON.stringify({
                              error: 'durable_history_unavailable',
                              message: 'Unavailable',
                          }),
                          { status: 503 },
                      )
                    : new Response(JSON.stringify(empty)),
            );
        });
        vi.stubGlobal('fetch', fetcher);
        await renderAppAt('/device-details/temp-desk');
        act(() =>
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [createTemperatureDevice()] }),
            ),
        );
        await screen.findByText(i18n.t('telemetry.errors.unavailable', { ns: 'deviceDetails' }));
        const table = screen.getByRole('table');
        expect(table).toHaveTextContent(i18n.t('telemetry.failed', { ns: 'deviceDetails' }));
        expect(table).not.toHaveTextContent(i18n.t('telemetry.empty', { ns: 'deviceDetails' }));
        fail = false;
        await userEvent.setup().click(
            screen.getByRole('button', {
                name: i18n.t('telemetry.retry', { ns: 'deviceDetails' }),
            }),
        );
        await waitFor(() =>
            expect(table).toHaveTextContent(i18n.t('telemetry.empty', { ns: 'deviceDetails' })),
        );
        expect(
            screen.queryByText(i18n.t('telemetry.errors.unavailable', { ns: 'deviceDetails' })),
        ).not.toBeInTheDocument();
    });

    it('loads retained LED history only after a snapshot confirms the selected device', async () => {
        const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
        vi.stubGlobal('fetch', fetcher);
        await renderAppAt('/device-details/led-main');
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
            screen.queryByRole('application', {
                name: i18n.t('chart.title', { ns: 'deviceDetails' }),
            }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole('table', { name: i18n.t('table.caption', { ns: 'deviceDetails' }) }),
        ).not.toBeInTheDocument();
    });
    it('reports an unknown device only after receiving its baseline', async () => {
        await renderAppAt('/device-details/missing-device');
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
        await act(async () => vi.dynamicImportSettled());
        await screen.findByRole('main');
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

    it('shows a not-found page for incomplete or unknown URLs', async () => {
        await renderAppAt('/device-details');

        expect(
            screen.getByRole('heading', { name: i18n.t('pageNotFound', { ns: 'deviceDetails' }) }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('link', { name: i18n.t('back', { ns: 'deviceDetails' }) }),
        ).toHaveAttribute('href', '/');
        expect(MockEventSource.instances).toHaveLength(0);
    });
});
