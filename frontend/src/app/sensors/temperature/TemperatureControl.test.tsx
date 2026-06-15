import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomSnapshotProjection } from '../../../../../shared/src/contracts';
import { TemperatureControl } from './TemperatureControl';

describe('TemperatureControl', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('shows loading while the room snapshot is being fetched', () => {
        mockFetch(new Promise(() => undefined));

        render(<TemperatureControl />);

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(screen.getByText('Backend snapshot')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Loading');
        expect(screen.getByText('Loading room snapshot...')).toBeInTheDocument();
    });

    it('renders the backend temperature sensor reading', async () => {
        mockFetch(
            Promise.resolve(
                createFetchResponse({
                    body: createRoomSnapshot(),
                }),
            ),
        );

        render(<TemperatureControl />);

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(await screen.findByRole('status')).toHaveTextContent('Online');
        expect(screen.getByText('Backend snapshot')).toBeInTheDocument();
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.4');
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('celsius');
        expect(screen.getByText('09:30:00 UTC')).toBeInTheDocument();
    });

    it('shows an empty state when no devices are available', async () => {
        mockFetch(
            Promise.resolve(
                createFetchResponse({
                    body: createRoomSnapshot({
                        devices: [],
                    }),
                }),
            ),
        );

        render(<TemperatureControl />);

        expect(await screen.findByRole('status')).toHaveTextContent('No reading');
        expect(screen.getByText('No temperature reading is available yet.')).toBeInTheDocument();
    });

    it('shows an empty state when no temperature sensor is available', async () => {
        mockFetch(
            Promise.resolve(
                createFetchResponse({
                    body: createRoomSnapshot({
                        devices: [createHumidityDevice()],
                    }),
                }),
            ),
        );

        render(<TemperatureControl />);

        expect(await screen.findByRole('status')).toHaveTextContent('No reading');
        expect(screen.getByText('No temperature reading is available yet.')).toBeInTheDocument();
    });

    it('shows an error state when the room snapshot request fails', async () => {
        mockFetch(
            Promise.resolve(
                createFetchResponse({
                    ok: false,
                    status: 503,
                    body: {
                        error: 'unavailable',
                    },
                }),
            ),
        );

        render(<TemperatureControl />);

        expect(await screen.findByRole('status')).toHaveTextContent('Unavailable');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Room snapshot is unavailable. Start the backend and refresh the page.',
        );
    });

    it('shows an error state when the room snapshot payload is invalid', async () => {
        mockFetch(
            Promise.resolve(
                createFetchResponse({
                    body: {
                        roomName: 'Smart Room',
                    },
                }),
            ),
        );

        render(<TemperatureControl />);

        expect(await screen.findByRole('status')).toHaveTextContent('Unavailable');
    });

    it('shows an error state when the temperature sensor payload is malformed', async () => {
        mockFetch(
            Promise.resolve(
                createFetchResponse({
                    body: createRoomSnapshot({
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
                }),
            ),
        );

        render(<TemperatureControl />);

        expect(await screen.findByRole('status')).toHaveTextContent('Unavailable');
    });

    it.each([
        ['stale', 'Stale'],
        ['offline', 'Offline'],
        ['degraded', 'Degraded'],
    ] as const)(
        'keeps the last temperature visible when the device is %s',
        async (health, label) => {
            mockFetch(
                Promise.resolve(
                    createFetchResponse({
                        body: createRoomSnapshot({
                            devices: [
                                {
                                    ...createTemperatureDevice(),
                                    health,
                                },
                            ],
                        }),
                    }),
                ),
            );

            render(<TemperatureControl />);

            expect(await screen.findByRole('status')).toHaveTextContent(label);
            expect(screen.queryByText('Online')).not.toBeInTheDocument();
            expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.4');
            expect(screen.getByText('09:30:00 UTC')).toBeInTheDocument();
        },
    );
});

function mockFetch(response: Promise<Response>): void {
    vi.mocked(fetch).mockReturnValue(response);
}

function createFetchResponse({
    ok = true,
    status = 200,
    body,
}: {
    ok?: boolean;
    status?: number;
    body: unknown;
}): Response {
    return {
        ok,
        status,
        json: () => Promise.resolve(body),
    } as Response;
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
