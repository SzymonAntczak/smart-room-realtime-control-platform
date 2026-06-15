import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomSnapshotProjection } from '../../../../../shared/src/contracts';
import { loadTemperatureSnapshot } from './room-snapshot-client';

describe('loadTemperatureSnapshot', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('fetches the room snapshot from the default BFF endpoint', async () => {
        mockFetch(createRoomSnapshot());

        await loadTemperatureSnapshot();

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith('http://localhost:4310/room');
    });

    it('fetches the room snapshot from the configured BFF endpoint', async () => {
        vi.stubEnv('VITE_ROOM_BFF_URL', 'http://127.0.0.1:4999');
        mockFetch(createRoomSnapshot());

        await loadTemperatureSnapshot();

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4999/room');
    });

    it('returns an empty result when the snapshot has no temperature sensor', async () => {
        mockFetch(
            createRoomSnapshot({
                devices: [createHumidityDevice()],
            }),
        );

        await expect(loadTemperatureSnapshot()).resolves.toEqual({
            status: 'empty',
        });
    });

    it('rejects a malformed temperature sensor payload', async () => {
        mockFetch(
            createRoomSnapshot({
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

        await expect(loadTemperatureSnapshot()).rejects.toThrow(
            'Temperature sensor data did not match the expected contract.',
        );
    });
});

function mockFetch(body: unknown): void {
    vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
    } as Response);
}

function createRoomSnapshot({
    devices = [createTemperatureDevice()],
}: {
    devices?: RoomSnapshotProjection['devices'];
} = {}): RoomSnapshotProjection {
    return {
        roomName: 'Smart Room',
        updatedAt: '2026-06-08T09:30:00Z',
        devices,
        activeCommands: [],
        recentEvents: [],
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
