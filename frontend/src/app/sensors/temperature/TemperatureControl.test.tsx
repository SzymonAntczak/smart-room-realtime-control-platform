import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type { RoomRealtimeServerMessage } from '@smart-room/contracts/realtime';
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
        expect(screen.getByText('Last reading 09:30:00 UTC.')).toBeInTheDocument();
        expect(
            screen.queryByRole('region', { name: 'Recent temperature events' }),
        ).not.toBeInTheDocument();
    });

    it('renders a configured bootstrap sensor before its first observation', async () => {
        render(<TemperatureControl />);

        await emitLatestMessage(
            createRoomSnapshotMessage({
                devices: [
                    {
                        ...createTemperatureDevice(),
                        availability: 'unknown',
                        health: 'unknown',
                        reportedState: {},
                        observationStatus: { temperature: { freshness: 'unknown' } },
                    },
                ],
            }),
        );

        expect(screen.getByRole('status')).toHaveTextContent('Unknown');
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('—');
        expect(screen.getByText('No reading received yet.')).toBeInTheDocument();
    });

    it('updates the temperature after a device delta', async () => {
        render(<TemperatureControl />);

        await emitLatestMessage(createRoomSnapshotMessage());
        await emitLatestMessage(
            createDeviceUpdatedMessage({
                ...createTemperatureDevice(),
                reportedState: { temperature: 22.6, temperatureUnit: 'celsius' },
                observationStatus: {
                    temperature: { freshness: 'fresh', lastObservedAt: '2026-06-08T09:30:01Z' },
                },
            }),
        );

        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.6');
        expect(screen.getByText('Last reading 09:30:01 UTC.')).toBeInTheDocument();
    });

    it('renders both temperature cards and updates only the targeted card', async () => {
        render(<TemperatureControl />);

        await emitLatestMessage(
            createRoomSnapshotMessage({
                devices: [
                    createTemperatureDevice(),
                    {
                        ...createTemperatureDevice(),
                        deviceId: 'temp-window',
                        name: 'Window Temperature',
                    },
                ],
            }),
        );
        await emitLatestMessage(
            createDeviceUpdatedMessage({
                ...createTemperatureDevice(),
                deviceId: 'temp-window',
                name: 'Window Temperature',
                reportedState: { temperature: 19.4, temperatureUnit: 'celsius' },
            }),
        );

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Window Temperature' })).toBeInTheDocument();
        expect(screen.getAllByLabelText('Current temperature')).toHaveLength(2);
        expect(screen.getAllByLabelText('Current temperature')[0]).toHaveTextContent('22.4');
        expect(screen.getAllByLabelText('Current temperature')[1]).toHaveTextContent('19.4');
        expect(MockWebSocket.instances).toHaveLength(1);
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
        expect(screen.getByRole('button', { name: 'Dev scenarios' })).toBeInTheDocument();
    });

    it('preserves the last reading and recovers after an invalid realtime snapshot', async () => {
        vi.useFakeTimers();
        render(<TemperatureControl />);

        await emitLatestMessage(createRoomSnapshotMessage());
        await emitLatestMessage({
            messageType: 'room.snapshot',
            sentAt: '2026-06-08T09:30:01Z',
            payload: {
                roomName: 'Smart Room',
            },
        });

        expect(screen.getByRole('status')).toHaveTextContent('Online');
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.4');
        expect(screen.getByText('Realtime room stream sent an invalid update.')).toHaveAttribute(
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
        expect(screen.queryByText('Realtime room stream sent an invalid update.')).toBeNull();
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
            'Realtime room stream sent an invalid update.',
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
            'Realtime stream is reconnecting. Showing the last valid temperature update.',
        );
    });

    it('shows stale freshness without changing online availability', async () => {
        render(<TemperatureControl />);
        await emitLatestMessage(
            createRoomSnapshotMessage({
                devices: [
                    {
                        ...createTemperatureDevice(),
                        observationStatus: {
                            temperature: {
                                freshness: 'stale',
                                lastObservedAt: '2026-06-08T09:30:00Z',
                            },
                        },
                    },
                ],
            }),
        );
        expect(await screen.findByText('Online')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Temperature telemetry is stale');
    });

    it('shows offline availability without discarding the last reading', async () => {
        render(<TemperatureControl />);
        await emitLatestMessage(
            createRoomSnapshotMessage({
                devices: [
                    {
                        ...createTemperatureDevice(),
                        availability: 'offline',
                        availabilityReason: 'device_disconnected',
                    },
                ],
            }),
        );
        expect(await screen.findByText('Offline')).toBeInTheDocument();
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.4');
    });

    it('shows degraded health separately from availability', async () => {
        render(<TemperatureControl />);
        await emitLatestMessage(
            createRoomSnapshotMessage({
                devices: [
                    {
                        ...createTemperatureDevice(),
                        health: 'degraded',
                        healthReason: 'partial_data',
                    },
                ],
            }),
        );
        expect(await screen.findByText('Online')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('partial_data');
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
}: {
    sentAt?: string;
    devices?: RoomSnapshotProjection['devices'];
} = {}): RoomRealtimeServerMessage {
    return {
        messageType: 'room.snapshot',
        revision: 0,
        sentAt,
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-06-08T09:30:00Z',
            devices,
            activeCommands: [],
            recentCommands: [],
        },
    };
}

function createDeviceUpdatedMessage(
    device: RoomSnapshotProjection['devices'][number],
): RoomRealtimeServerMessage {
    return {
        messageType: 'device.updated',
        previousRevision: 0,
        revision: 1,
        sentAt: '2026-06-08T09:30:02Z',
        payload: device,
    };
}

function createTemperatureDevice(): RoomSnapshotProjection['devices'][number] {
    return {
        deviceId: 'temp-desk',
        name: 'Desk Temperature',
        role: 'temperature-sensor',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        reportedState: {
            temperature: 22.4,
            temperatureUnit: 'celsius',
        },
        commandAvailability: {
            policy: 'block',
            reason: 'read_only_device',
        },
        observationStatus: {
            temperature: { freshness: 'fresh', lastObservedAt: '2026-06-08T09:30:00Z' },
        },
    };
}

function createHumidityDevice(): RoomSnapshotProjection['devices'][number] {
    return {
        deviceId: 'humidity-desk',
        name: 'Desk Humidity',
        role: 'humidity-sensor',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        reportedState: {
            humidity: 45,
            humidityUnit: 'percent',
        },
        commandAvailability: {
            policy: 'block',
            reason: 'read_only_device',
        },
        observationStatus: {
            humidity: { freshness: 'fresh', lastObservedAt: '2026-06-08T09:30:00Z' },
        },
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
