import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
    RoomRealtimeServerMessage,
    RoomSnapshotProjection,
} from '../../../../../shared/src/contracts';
import { TemperatureControl } from './TemperatureControl';

describe('TemperatureControl', () => {
    beforeEach(() => {
        MockWebSocket.instances.length = 0;
        globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    });

    afterEach(() => {
        MockWebSocket.instances.length = 0;
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
        expect(screen.getByText('Realtime room stream')).toBeInTheDocument();
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.4');
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('celsius');
        expect(screen.getByText('09:30:00 UTC')).toBeInTheDocument();
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

    it('shows an error state when the realtime stream fails before a snapshot', async () => {
        render(<TemperatureControl />);

        await act(async () => {
            MockWebSocket.latest().emitError();
        });

        expect(await screen.findByRole('status')).toHaveTextContent('Unavailable');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Realtime room stream is unavailable. Start the backend and refresh the page.',
        );
    });

    it('shows an error state when the realtime stream payload is invalid', async () => {
        render(<TemperatureControl />);

        await emitLatestMessage({
            messageType: 'room.snapshot',
            version: 1,
            sentAt: '2026-06-08T09:30:01Z',
            payload: {
                roomName: 'Smart Room',
            },
        });

        expect(await screen.findByRole('status')).toHaveTextContent('Unavailable');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Realtime room stream sent an invalid snapshot.',
        );
    });

    it('shows an error state when the temperature sensor payload is malformed', async () => {
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

        expect(await screen.findByRole('status')).toHaveTextContent('Unavailable');
    });

    it('keeps the last temperature visible when the realtime stream disconnects', async () => {
        render(<TemperatureControl />);

        await emitLatestMessage(createRoomSnapshotMessage());

        await act(async () => {
            MockWebSocket.latest().close();
        });

        expect(await screen.findByRole('status')).toHaveTextContent('Online');
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.4');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Realtime stream disconnected. Showing the last temperature snapshot.',
        );
    });

    it.each([
        ['stale', 'Stale'],
        ['offline', 'Offline'],
        ['degraded', 'Degraded'],
    ] as const)(
        'keeps the last temperature visible when the device is %s',
        async (health, label) => {
            render(<TemperatureControl />);

            await emitLatestMessage(
                createRoomSnapshotMessage({
                    devices: [
                        {
                            ...createTemperatureDevice(),
                            health,
                        },
                    ],
                }),
            );

            expect(await screen.findByRole('status')).toHaveTextContent(label);
            expect(screen.queryByText('Online')).not.toBeInTheDocument();
            expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.4');
            expect(screen.getByText('09:30:00 UTC')).toBeInTheDocument();
        },
    );
});

async function emitLatestMessage(message: unknown): Promise<void> {
    await act(async () => {
        MockWebSocket.latest().emitMessage(message);
    });
}

function createRoomSnapshotMessage({
    devices = [createTemperatureDevice()],
}: {
    devices?: RoomSnapshotProjection['devices'];
} = {}): RoomRealtimeServerMessage {
    return {
        messageType: 'room.snapshot',
        version: 1,
        sentAt: '2026-06-08T09:30:01Z',
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-06-08T09:30:00Z',
            devices,
            activeCommands: [],
            recentEvents: [],
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
