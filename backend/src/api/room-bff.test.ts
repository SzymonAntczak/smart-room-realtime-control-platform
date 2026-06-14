import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { EventProcessingDiagnosticsSnapshot } from '../platform/event-processing/event-processing-diagnostics';
import type { RoomSnapshotProjection } from '../../../shared/src/projections';
import { createRoomBffServer } from './room-bff';

describe('createRoomBffServer', () => {
    const openServers: Server[] = [];

    afterEach(async () => {
        await Promise.all(openServers.map((server) => closeServer(server)));
        openServers.length = 0;
    });

    it('serves the current room snapshot', async () => {
        const server = await listen(
            createRoomBffServer(createRoomBffConfig()),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room`);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        await expect(response.json()).resolves.toEqual(createRoomSnapshot());
    });

    it('serves derived stale health from the current room snapshot', async () => {
        const server = await listen(
            createRoomBffServer(
                createRoomBffConfig({
                    roomSnapshot: createRoomSnapshot({
                        health: 'stale',
                    }),
                }),
            ),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            devices: [
                {
                    deviceId: 'temp-desk',
                    health: 'stale',
                },
            ],
        });
    });

    it('returns 404 for unknown routes', async () => {
        const server = await listen(
            createRoomBffServer(createRoomBffConfig()),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/unknown`);

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            error: 'not_found',
        });
    });

    it('returns 405 for unsupported room route methods', async () => {
        const server = await listen(
            createRoomBffServer(createRoomBffConfig()),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room`, {
            method: 'POST',
        });

        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('GET, OPTIONS');
        await expect(response.json()).resolves.toMatchObject({
            error: 'method_not_allowed',
        });
    });

    it('handles CORS preflight requests', async () => {
        const server = await listen(
            createRoomBffServer(createRoomBffConfig()),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room`, {
            method: 'OPTIONS',
        });

        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    });

    it('serves the current event processing diagnostics snapshot', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/diagnostics`);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        await expect(response.json()).resolves.toEqual(createDiagnosticsSnapshot());
    });

    it('returns 405 for unsupported diagnostics route methods', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/diagnostics`, {
            method: 'POST',
        });

        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('GET, OPTIONS');
        await expect(response.json()).resolves.toMatchObject({
            error: 'method_not_allowed',
        });
    });
});

function createRoomBffConfig({
    roomSnapshot = createRoomSnapshot(),
}: {
    roomSnapshot?: RoomSnapshotProjection;
} = {}) {
    return {
        getRoomSnapshot() {
            return roomSnapshot;
        },
        getDiagnosticsSnapshot() {
            return createDiagnosticsSnapshot();
        },
    };
}

function createRoomSnapshot({
    health = 'online',
}: {
    health?: RoomSnapshotProjection['devices'][number]['health'];
} = {}): RoomSnapshotProjection {
    return {
        roomName: 'Smart Room',
        updatedAt: '2026-06-08T09:30:00Z',
        devices: [
            {
                deviceId: 'temp-desk',
                name: 'Desk Temperature',
                role: 'temperature-sensor',
                health,
                reportedState: {
                    temperature: 22,
                    temperatureUnit: 'celsius',
                },
                commandAvailability: {
                    policy: 'block',
                    reason: 'read_only_device',
                },
                lastSeenAt: '2026-06-08T09:30:00Z',
            },
        ],
        activeCommands: [],
        recentEvents: [
            {
                eventId: 'evt-temperature-1',
                eventType: 'telemetry.reading.recorded',
                occurredAt: '2026-06-08T09:30:00Z',
                source: 'simulator-adapter',
                deviceId: 'temp-desk',
                commandId: undefined,
                summary: 'Temperature reading recorded',
            },
        ],
    };
}

function createDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot {
    return {
        ignoredEvents: [
            {
                diagnosticId: 'diag-1',
                reason: 'duplicate_event',
                observedAt: '2026-06-08T09:30:01Z',
                eventId: 'evt-temperature-1',
                eventType: 'telemetry.reading.recorded',
                source: 'simulator-adapter',
                deviceId: 'temp-desk',
                occurredAt: '2026-06-08T09:30:01Z',
            },
        ],
    };
}

function listen(server: Server): Promise<Server> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve(server);
        });
    });
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

function serverUrl(server: Server): string {
    const address = server.address() as AddressInfo;

    return `http://127.0.0.1:${address.port}`;
}
