import { isRawTelemetryPage, type RawTelemetryPage } from '@smart-room/contracts/history';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { isRoomBffRealtimeServerMessage } from '@smart-room/contracts/room-bff';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, StrictMode } from 'react';
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
import type * as InfiniteScrollingModule from '../../features/infinite-scrolling';
import { i18n } from '../../i18n';

vi.mock('../../features/infinite-scrolling', async (importOriginal) => {
    const actual = await importOriginal<typeof InfiniteScrollingModule>();

    return {
        ...actual,
        InfiniteList: ({
            items,
            renderItem,
            getItemKey,
            ariaLabel,
            afterItems,
        }: {
            items: readonly unknown[];
            renderItem(item: unknown, index: number): ReactNode;
            getItemKey(item: unknown): string;
            ariaLabel: string;
            afterItems?: ReactNode;
        }) => (
            <div role="region" aria-label={ariaLabel}>
                <ol>
                    {items.map((item, index) => (
                        <li key={getItemKey(item)}>{renderItem(item, index)}</li>
                    ))}
                </ol>
                {afterItems}
            </div>
        ),
    };
});

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
            screen.getByRole('region', {
                name: i18n.t('telemetryList.scrollRegion', { ns: 'deviceDetails' }),
            }),
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
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
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

    it.each([
        { freshness: 'fresh', availability: 'online' },
        { freshness: 'stale', availability: 'online' },
        { freshness: 'stale', availability: 'offline' },
        { freshness: 'unknown', availability: 'online' },
    ] as const)(
        'shows $freshness observation evidence independently of $availability availability',
        async ({ freshness, availability }) => {
            const lastObservedAt = '2026-06-08T09:30:00Z';
            const device: ReturnType<typeof createTemperatureDevice> = {
                ...createTemperatureDevice(),
                availability,
                ...(availability === 'offline'
                    ? { availabilityReason: 'transport_disconnected' }
                    : {}),
                reportedState:
                    freshness === 'unknown'
                        ? {}
                        : { temperature: 22.4, temperatureUnit: 'celsius' },
                observationStatus: {
                    temperature: {
                        freshness,
                        durability: 'durable',
                        ...(freshness === 'unknown' ? {} : { lastObservedAt }),
                    },
                },
            };
            const message = createRoomSnapshotMessage({ devices: [device] });
            expect(isRoomBffRealtimeServerMessage(message)).toBe(true);
            await renderAppAt('/device-details/temp-desk');
            act(() => MockEventSource.latest().emitMessage(message));

            const observation = screen.getByRole('status', {
                name: i18n.t('telemetry.observationStatus', { ns: 'deviceDetails' }),
            });
            expect(observation).toHaveTextContent(
                i18n.t(`telemetry.freshness.${freshness}`, { ns: 'deviceDetails' }),
            );
            expect(
                within(
                    screen.getByRole('region', {
                        name: i18n.t('summary', { ns: 'deviceDetails' }),
                    }),
                ).getByRole('status'),
            ).toHaveTextContent(i18n.t(`availability.${availability}`, { ns: 'common' }));

            if (freshness === 'unknown') {
                expect(observation).not.toHaveTextContent(
                    i18n.t('telemetry.lastObserved', { ns: 'deviceDetails' }),
                );
            } else {
                expect(
                    within(observation).getByText(formatTimestamp(lastObservedAt)),
                ).toHaveAttribute('datetime', lastObservedAt);
            }
        },
    );

    it('loads a static first page independently while the live chart reads its bounded baseline', async () => {
        const first = makeTelemetryPage(300, 100, 'older');
        const second = makeTelemetryPage(200, 2, null);
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>(async (input) => {
                const url = new URL(String(input));

                if (url.pathname !== '/room/history/telemetry') {
                    return new Promise(() => undefined);
                }

                return new Response(
                    JSON.stringify(url.searchParams.has('cursor') ? second : first),
                );
            }),
        );
        await renderAppAt('/device-details/temp-desk');
        act(() =>
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [createTemperatureDevice()] }),
            ),
        );
        const chart = screen.getByRole('application', {
            name: i18n.t('chart.title', { ns: 'deviceDetails' }),
        });
        await waitFor(() => expect(chart).toHaveAccessibleDescription(new RegExp('199\\.125')));
        const list = screen.getByRole('region', {
            name: i18n.t('telemetryList.scrollRegion', { ns: 'deviceDetails' }),
        });
        expect(within(list).getAllByRole('listitem')).toHaveLength(100);
        expect(list).toHaveTextContent('300.125');
        expect(list).not.toHaveTextContent('199.125');
        const sample = {
            recordId: 'rec:v1:sha256:' + 'f'.repeat(64),
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
        expect(chart).toHaveAccessibleDescription(/25\.25/);
        expect(list).not.toHaveTextContent('25.25');
        expect(within(list).getAllByRole('listitem')).toHaveLength(100);
    });

    it('retries an unavailable static list without refreshing the chart', async () => {
        const empty = {
            ...createHistoryIdentityFixtures().rawTelemetryPage,
            historyGenerationId: 'generation-test',
            pageSize: 100,
            items: [],
            nextCursor: null,
        };
        let fail = true;
        const fetcher = vi.fn<typeof fetch>(async (input) => {
            if (new URL(String(input)).pathname !== '/room/history/telemetry') {
                return new Promise(() => undefined);
            }

            return fail
                ? new Response(
                      JSON.stringify({
                          error: 'durable_history_unavailable',
                          message: 'Unavailable',
                      }),
                      { status: 503 },
                  )
                : new Response(JSON.stringify(empty));
        });
        vi.stubGlobal('fetch', fetcher);
        await renderAppAt('/device-details/temp-desk');
        act(() =>
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [createTemperatureDevice()] }),
            ),
        );
        const list = screen.getByRole('region', {
            name: i18n.t('telemetryList.scrollRegion', { ns: 'deviceDetails' }),
        });
        await within(list).findByRole('alert');
        expect(list).not.toHaveTextContent(i18n.t('telemetry.empty', { ns: 'deviceDetails' }));
        fail = false;
        const count = fetcher.mock.calls.length;
        await userEvent.setup().click(
            within(list).getByRole('button', {
                name: i18n.t('telemetry.retry', { ns: 'deviceDetails' }),
            }),
        );
        await within(list).findByText(i18n.t('telemetry.empty', { ns: 'deviceDetails' }));
        expect(fetcher).toHaveBeenCalledTimes(count + 1);
        expect(
            screen.getByText(i18n.t('telemetry.errors.unavailable', { ns: 'deviceDetails' })),
        ).toBeInTheDocument();
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
            screen.queryByRole('region', {
                name: i18n.t('telemetryList.scrollRegion', { ns: 'deviceDetails' }),
            }),
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
