import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { EventProcessingDiagnosticsSnapshot } from '../platform/event-processing/event-processing-diagnostics';
import type { RoomSnapshotProjection } from '../../../shared/src/projections';
import type { RoomRealtimeServerMessage } from '../../../shared/src/realtime';
import { createTemperatureRoomRuntime } from '../runtime/temperature-room-runtime';
import { createRoomBffServer } from './room-bff';

describe('createRoomBffServer', () => {
    const openServers: Server[] = [];
    const openSockets: WebSocket[] = [];

    afterEach(async () => {
        openSockets.forEach((socket) => socket.close());
        openSockets.length = 0;
        await Promise.all(openServers.map((server) => closeServer(server)));
        openServers.length = 0;
    });

    it('serves the current room snapshot', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
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
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/unknown`);

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            error: 'not_found',
        });
    });

    it('returns 405 for unsupported room route methods', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
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
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room`, {
            method: 'OPTIONS',
        });

        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
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

    it('runs a validated development temperature scenario', async () => {
        const actions: string[] = [];
        const server = await listen(
            createRoomBffServer({
                ...createRoomBffConfig(),
                runScenario(action) {
                    actions.push(action);
                    return { action, status: 'completed' };
                },
            }),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/scenarios/temperature`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pause_telemetry' }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            action: 'pause_telemetry',
            status: 'completed',
        });
        expect(actions).toEqual(['pause_telemetry']);
    });

    it('routes a development scenario through the real runtime and room projection', async () => {
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 10_000,
        });
        runtime.start();
        const server = await listen(
            createRoomBffServer({
                getRoomSnapshot: runtime.getRoomSnapshot,
                getDiagnosticsSnapshot: runtime.getDiagnosticsSnapshot,
                subscribeRoomSnapshot: runtime.subscribeRoomSnapshot,
                runScenario: runtime.runScenario,
            }),
        );
        openServers.push(server);

        try {
            const actionResponse = await fetch(`${serverUrl(server)}/dev/scenarios/temperature`, {
                method: 'POST',
                body: JSON.stringify({ action: 'emit_next_reading' }),
            });
            const roomResponse = await fetch(`${serverUrl(server)}/room`);

            expect(actionResponse.status).toBe(200);
            await expect(roomResponse.json()).resolves.toMatchObject({
                recentEvents: [
                    expect.objectContaining({
                        eventType: 'telemetry.reading.recorded',
                    }),
                    expect.objectContaining({
                        eventType: 'telemetry.reading.recorded',
                    }),
                ],
            });
        } finally {
            runtime.stop();
        }
    });

    it('keeps development scenarios unavailable when no control handler is configured', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/scenarios/temperature`, {
            method: 'POST',
            body: JSON.stringify({ action: 'pause_telemetry' }),
        });

        expect(response.status).toBe(404);
    });

    it('rejects unsupported development scenario actions', async () => {
        const server = await listen(
            createRoomBffServer({
                ...createRoomBffConfig(),
                runScenario(action) {
                    return { action, status: 'completed' };
                },
            }),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/scenarios/temperature`, {
            method: 'POST',
            body: JSON.stringify({ action: 'delete_room' }),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: 'invalid_request',
        });
    });

    it('reports scenario execution failures without treating them as invalid requests', async () => {
        const server = await listen(
            createRoomBffServer({
                ...createRoomBffConfig(),
                runScenario() {
                    throw new Error('Simulator unavailable.');
                },
            }),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/scenarios/temperature`, {
            method: 'POST',
            body: JSON.stringify({ action: 'pause_telemetry' }),
        });

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
            error: 'scenario_failed',
            message: 'Scenario could not be executed.',
        });
    });

    it('sends an initial room snapshot over the realtime WebSocket', async () => {
        const harness = createRoomBffHarness({
            sentAt: ['2026-06-08T09:30:01Z'],
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);

        const socket = connectWebSocket(server);
        openSockets.push(socket);

        await expect(readRealtimeMessage(socket)).resolves.toEqual({
            messageType: 'room.snapshot',
            version: 1,
            sentAt: '2026-06-08T09:30:01Z',
            payload: createRoomSnapshot(),
        });
    });

    it('registers the realtime subscriber before sending the initial room snapshot', async () => {
        const harness = createRoomBffHarness({
            roomSnapshot: createRoomSnapshot({
                temperature: 22,
            }),
            sentAt: ['2026-06-08T09:30:01Z'],
            onSubscribe() {
                harness.setRoomSnapshot(
                    createRoomSnapshot({
                        temperature: 22.8,
                        updatedAt: '2026-06-08T09:30:01Z',
                    }),
                );
            },
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);

        const socket = connectWebSocket(server);
        openSockets.push(socket);

        await expect(readRealtimeMessage(socket)).resolves.toMatchObject({
            messageType: 'room.snapshot',
            payload: {
                updatedAt: '2026-06-08T09:30:01Z',
                devices: [
                    expect.objectContaining({
                        reportedState: {
                            temperature: 22.8,
                            temperatureUnit: 'celsius',
                        },
                    }),
                ],
            },
        });
    });

    it('streams room snapshot updates over the realtime WebSocket', async () => {
        const harness = createRoomBffHarness({
            sentAt: ['2026-06-08T09:30:01Z', '2026-06-08T09:30:02Z'],
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);

        const socket = connectWebSocket(server);
        openSockets.push(socket);
        await readRealtimeMessage(socket);

        harness.publishRoomSnapshot(
            createRoomSnapshot({
                temperature: 22.4,
                updatedAt: '2026-06-08T09:30:02Z',
            }),
        );

        await expect(readRealtimeMessage(socket)).resolves.toMatchObject({
            messageType: 'room.snapshot',
            version: 1,
            sentAt: '2026-06-08T09:30:02Z',
            payload: {
                updatedAt: '2026-06-08T09:30:02Z',
                devices: [
                    expect.objectContaining({
                        reportedState: {
                            temperature: 22.4,
                            temperatureUnit: 'celsius',
                        },
                    }),
                ],
            },
        });
    });

    it('removes realtime snapshot subscriptions when the WebSocket closes', async () => {
        const harness = createRoomBffHarness({
            sentAt: ['2026-06-08T09:30:01Z'],
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);

        const socket = connectWebSocket(server);
        openSockets.push(socket);
        await readRealtimeMessage(socket);

        expect(harness.listenerCount()).toBe(1);

        await closeWebSocket(socket);
        await waitForCondition(() => harness.listenerCount() === 0);

        expect(harness.listenerCount()).toBe(0);
        harness.publishRoomSnapshot(
            createRoomSnapshot({
                temperature: 22.6,
                updatedAt: '2026-06-08T09:30:03Z',
            }),
        );
        expect(harness.listenerCount()).toBe(0);
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
        subscribeRoomSnapshot() {
            return () => undefined;
        },
    };
}

function createRoomBffHarness({
    roomSnapshot = createRoomSnapshot(),
    sentAt,
    onSubscribe,
}: {
    roomSnapshot?: RoomSnapshotProjection;
    sentAt: string[];
    onSubscribe?: () => void;
}) {
    let currentRoomSnapshot = roomSnapshot;
    const listeners = new Set<(snapshot: RoomSnapshotProjection) => void>();
    const pendingSentAt = [...sentAt];

    return {
        config: {
            getRoomSnapshot() {
                return currentRoomSnapshot;
            },
            getDiagnosticsSnapshot() {
                return createDiagnosticsSnapshot();
            },
            subscribeRoomSnapshot(listener: (snapshot: RoomSnapshotProjection) => void) {
                listeners.add(listener);
                onSubscribe?.();

                return () => {
                    listeners.delete(listener);
                };
            },
            now() {
                const timestamp = pendingSentAt.shift();

                if (!timestamp) {
                    throw new Error('No deterministic sentAt timestamp configured.');
                }

                return timestamp;
            },
        },
        publishRoomSnapshot(snapshot: RoomSnapshotProjection) {
            currentRoomSnapshot = snapshot;

            for (const listener of listeners) {
                listener(snapshot);
            }
        },
        setRoomSnapshot(snapshot: RoomSnapshotProjection) {
            currentRoomSnapshot = snapshot;
        },
        listenerCount() {
            return listeners.size;
        },
    };
}

function createRoomSnapshot({
    health = 'online',
    temperature = 22,
    updatedAt = '2026-06-08T09:30:00Z',
}: {
    health?: RoomSnapshotProjection['devices'][number]['health'];
    temperature?: number;
    updatedAt?: string;
} = {}): RoomSnapshotProjection {
    return {
        roomName: 'Smart Room',
        updatedAt,
        devices: [
            {
                deviceId: 'temp-desk',
                name: 'Desk Temperature',
                role: 'temperature-sensor',
                health,
                reportedState: {
                    temperature,
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

function websocketUrl(server: Server): string {
    const address = server.address() as AddressInfo;

    return `ws://127.0.0.1:${address.port}/room/realtime`;
}

function connectWebSocket(server: Server): WebSocket {
    return new WebSocket(websocketUrl(server));
}

function readRealtimeMessage(socket: WebSocket): Promise<RoomRealtimeServerMessage> {
    return new Promise((resolve, reject) => {
        socket.once('message', (data) => {
            try {
                resolve(JSON.parse(data.toString()) as RoomRealtimeServerMessage);
            } catch (error) {
                reject(error);
            }
        });
        socket.once('error', reject);
    });
}

function closeWebSocket(socket: WebSocket): Promise<void> {
    return new Promise((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
        }

        socket.once('close', () => {
            resolve();
        });
        socket.close();
    });
}

function waitForCondition(condition: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const interval = setInterval(() => {
            if (condition()) {
                clearInterval(interval);
                resolve();
                return;
            }

            if (Date.now() - startedAt > 1000) {
                clearInterval(interval);
                reject(new Error('Condition was not met before the timeout.'));
            }
        }, 5);
    });
}
