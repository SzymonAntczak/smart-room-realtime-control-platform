import type { RoomRealtimeServerMessage, RoomSnapshotProjection } from '@smart-room/contracts';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TemperatureControl } from './TemperatureControl';

describe('TemperatureControl', () => {
    beforeEach(() => {
        MockWebSocket.instances.length = 0;
        globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    });

    afterEach(() => {
        MockWebSocket.instances.length = 0;
        vi.useRealTimers();
    });

    it('shows connecting while waiting for the first realtime snapshot', () => {
        render(<TemperatureControl />);

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(screen.getByText('Realtime room stream')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Connecting');
        expect(screen.getByText('Connecting to realtime room stream...')).toBeInTheDocument();
    });

    it('renders the realtime temperature sensor reading', async () => {
        render(<TemperatureControl />);

        await emitLatestMessage(createRoomSnapshotMessage());

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(await screen.findByRole('status')).toHaveTextContent('Online');
        expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'success');
        expect(screen.getByRole('status').querySelector('svg')).toHaveAttribute(
            'aria-hidden',
            'true',
        );
        expect(screen.getByText('Realtime room stream')).toBeInTheDocument();
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.4');
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('celsius');
        expect(screen.getAllByText('09:30:00 UTC').length).toBeGreaterThan(0);
        expect(screen.getByText(/Last reading/)).toHaveTextContent('1s old');
        expect(screen.getByRole('region', { name: 'Recent temperature events' })).toHaveTextContent(
            'Temperature reading recorded',
        );
    });

    it('updates the temperature after another realtime snapshot', async () => {
        render(<TemperatureControl />);

        await emitLatestMessage(createRoomSnapshotMessage());
        await emitLatestMessage(
            createRoomSnapshotMessage({
                devices: [
                    {
                        ...createTemperatureDevice(),
                        reportedState: {
                            temperature: 22.6,
                            temperatureUnit: 'celsius',
                        },
                        lastSeenAt: '2026-06-08T09:30:01Z',
                    },
                ],
            }),
        );

        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.6');
        expect(screen.getByText('09:30:01 UTC')).toBeInTheDocument();
    });

    it('shows an empty state when no devices are available', async () => {
        render(<TemperatureControl />);

        await emitLatestMessage(
            createRoomSnapshotMessage({
                devices: [],
            }),
        );

        expect(await screen.findByRole('status')).toHaveTextContent('No reading');
        expect(screen.getByText('No temperature reading is available yet.')).toBeInTheDocument();
    });

    it('shows an empty state when no temperature sensor is available', async () => {
        render(<TemperatureControl />);

        await emitLatestMessage(
            createRoomSnapshotMessage({
                devices: [createHumidityDevice()],
            }),
        );

        expect(await screen.findByRole('status')).toHaveTextContent('No reading');
        expect(screen.getByText('No temperature reading is available yet.')).toBeInTheDocument();
    });

    it('shows reconnecting when the realtime stream fails before a snapshot', async () => {
        render(<TemperatureControl />);

        await act(async () => {
            MockWebSocket.latest().emitError();
        });

        expect(await screen.findByRole('status')).toHaveTextContent('Reconnecting');
        expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'warning');
        expect(screen.getByText('Reconnecting to realtime room stream...')).toBeInTheDocument();
    });

    it('preserves the last reading and recovers after an invalid realtime snapshot', async () => {
        vi.useFakeTimers();
        render(<TemperatureControl />);

        await emitLatestMessage(createRoomSnapshotMessage());
        await emitLatestMessage({
            messageType: 'room.snapshot',
            version: 1,
            sentAt: '2026-06-08T09:30:01Z',
            payload: {
                roomName: 'Smart Room',
            },
        });

        expect(screen.getByRole('status')).toHaveTextContent('Online');
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.4');
        expect(screen.getByText('Realtime room stream sent an invalid snapshot.')).toHaveAttribute(
            'role',
            'alert',
        );

        await act(async () => {
            vi.advanceTimersByTime(1000);
        });

        expect(MockWebSocket.instances).toHaveLength(2);

        await emitLatestMessage(
            createRoomSnapshotMessage({
                devices: [
                    {
                        ...createTemperatureDevice(),
                        reportedState: {
                            temperature: 22.6,
                            temperatureUnit: 'celsius',
                        },
                    },
                ],
            }),
        );

        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.6');
        expect(screen.queryByText('Realtime room stream sent an invalid snapshot.')).toBeNull();
    });

    it('shows the contract error while reconnecting when the first snapshot is malformed', async () => {
        render(<TemperatureControl />);

        await emitLatestMessage(
            createRoomSnapshotMessage({
                devices: [
                    {
                        ...createTemperatureDevice(),
                        reportedState: {
                            temperature: '22.4',
                            temperatureUnit: 'celsius',
                        },
                    } as unknown as RoomSnapshotProjection['devices'][number],
                ],
            }),
        );

        expect(await screen.findByRole('status')).toHaveTextContent('Reconnecting');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Realtime room stream sent an invalid snapshot.',
        );
    });

    it('keeps the last temperature visible while the realtime stream reconnects', async () => {
        render(<TemperatureControl />);

        await emitLatestMessage(createRoomSnapshotMessage());

        await act(async () => {
            MockWebSocket.latest().close();
        });

        expect(await screen.findByRole('status')).toHaveTextContent('Online');
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.4');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Realtime stream is reconnecting. Showing the last temperature snapshot.',
        );
    });

    it.each([
        [
            'stale',
            'Stale',
            'warning',
            'Temperature telemetry is stale. Showing the last known reading from 09:30:00 UTC (6s old).',
        ],
        [
            'offline',
            'Offline',
            'danger',
            'Temperature sensor is offline. Showing the last known reading from 09:30:00 UTC (6s old).',
        ],
        [
            'degraded',
            'Degraded',
            'warning',
            'Temperature sensor is degraded. Showing the latest reported reading from 09:30:00 UTC (6s old).',
        ],
    ] as const)(
        'keeps the last temperature visible when the device is %s',
        async (health, label, tone, warning) => {
            render(<TemperatureControl />);

            await emitLatestMessage(
                createRoomSnapshotMessage({
                    sentAt: '2026-06-08T09:30:06Z',
                    devices: [
                        {
                            ...createTemperatureDevice(),
                            health,
                        },
                    ],
                }),
            );

            expect(await screen.findByRole('status')).toHaveTextContent(label);
            expect(screen.getByRole('status')).toHaveAttribute('data-tone', tone);
            expect(screen.getByRole('status').querySelector('svg')).toHaveAttribute(
                'aria-hidden',
                'true',
            );
            expect(screen.queryByText('Online')).not.toBeInTheDocument();
            expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.4');
            expect(screen.getAllByText('09:30:00 UTC').length).toBeGreaterThan(0);
            expect(screen.getByRole('alert')).toHaveTextContent(warning);
        },
    );

    it('renders at most the recent temperature events from the realtime snapshot', async () => {
        render(<TemperatureControl />);

        await emitLatestMessage(
            createRoomSnapshotMessage({
                recentEvents: [
                    createEventFeedItem({ eventId: 'evt-temperature-6' }),
                    createEventFeedItem({ eventId: 'evt-temperature-5' }),
                    createEventFeedItem({ eventId: 'evt-temperature-4' }),
                    createEventFeedItem({ eventId: 'evt-temperature-3' }),
                    createEventFeedItem({ eventId: 'evt-temperature-2' }),
                    createEventFeedItem({ eventId: 'evt-temperature-1' }),
                    createEventFeedItem({
                        eventId: 'evt-humidity-1',
                        deviceId: 'humidity-desk',
                        summary: 'Humidity reading recorded',
                    }),
                ],
            }),
        );

        const feed = screen.getByRole('region', { name: 'Recent temperature events' });

        expect(feed.querySelectorAll('li')).toHaveLength(5);
        expect(feed).toHaveTextContent('09:30:00 UTC');
        expect(feed).not.toHaveTextContent('Humidity reading recorded');
    });
});

async function emitLatestMessage(message: unknown): Promise<void> {
    await act(async () => {
        MockWebSocket.latest().emitMessage(message);
    });
}

function createRoomSnapshotMessage({
    sentAt = '2026-06-08T09:30:01Z',
    devices = [createTemperatureDevice()],
    recentEvents = [
        createEventFeedItem({
            eventId: 'evt-temperature-1',
            occurredAt: '2026-06-08T09:30:00Z',
        }),
    ],
}: {
    sentAt?: string;
    devices?: RoomSnapshotProjection['devices'];
    recentEvents?: RoomSnapshotProjection['recentEvents'];
} = {}): RoomRealtimeServerMessage {
    return {
        messageType: 'room.snapshot',
        version: 1,
        sentAt,
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-06-08T09:30:00Z',
            devices,
            activeCommands: [],
            recentEvents,
        },
    };
}

function createTemperatureDevice(): RoomSnapshotProjection['devices'][number] {
    return {
        deviceId: 'temp-desk',
        name: 'Desk Temperature',
        role: 'temperature-sensor',
        health: 'online',
        reportedState: {
            temperature: 22.4,
            temperatureUnit: 'celsius',
        },
        commandAvailability: {
            policy: 'block',
            reason: 'read_only_device',
        },
        lastSeenAt: '2026-06-08T09:30:00Z',
    };
}

function createEventFeedItem({
    eventId,
    deviceId = 'temp-desk',
    occurredAt = '2026-06-08T09:30:00Z',
    summary = 'Temperature reading recorded',
}: {
    eventId: string;
    deviceId?: string;
    occurredAt?: string;
    summary?: string;
}): RoomSnapshotProjection['recentEvents'][number] {
    return {
        eventId,
        eventType: 'telemetry.reading.recorded',
        occurredAt,
        source: 'simulator-adapter',
        deviceId,
        commandId: undefined,
        summary,
    };
}

function createHumidityDevice(): RoomSnapshotProjection['devices'][number] {
    return {
        deviceId: 'humidity-desk',
        name: 'Desk Humidity',
        role: 'humidity-sensor',
        health: 'online',
        reportedState: {
            humidity: 45,
            humidityUnit: 'percent',
        },
        commandAvailability: {
            policy: 'block',
            reason: 'read_only_device',
        },
        lastSeenAt: '2026-06-08T09:30:00Z',
    };
}

class MockWebSocket extends EventTarget {
    static instances: MockWebSocket[] = [];

    readonly url: string;

    constructor(url: string) {
        super();
        this.url = url;
        MockWebSocket.instances.push(this);
    }

    static latest(): MockWebSocket {
        const instance = MockWebSocket.instances.at(-1);

        if (!instance) {
            throw new Error('No mock websocket instance was created.');
        }

        return instance;
    }

    close(): void {
        this.dispatchEvent(new Event('close'));
    }

    emitError(): void {
        this.dispatchEvent(new Event('error'));
    }

    emitMessage(data: unknown): void {
        this.dispatchEvent(
            new MessageEvent('message', {
                data: JSON.stringify(data),
            }),
        );
    }
}
