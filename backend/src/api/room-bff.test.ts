import type { AddressInfo } from 'node:net';

import type {
    RoomRealtimeServerMessage,
    RoomSnapshotProjection,
    TemperatureScenarioAction,
} from '@smart-room/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { EventProcessingDiagnosticsSnapshot } from '../platform/event-processing/event-processing-diagnostics';
import { createTemperatureRoomRuntime } from '../runtime/temperature-room-runtime';

import { createRoomBffServer } from './room-bff';

describe('createRoomBffServer', () => {
    const openServers: FastifyInstance[] = [];
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

    it('discovers and runs a validated scenario for the requested device', async () => {
        const actions: Array<{ deviceId: string; action: string }> = [];
        const server = await listen(createRoomBffServer(createScenarioBffConfig(actions)));
        openServers.push(server);

        const discovery = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`);
        const response = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pause_telemetry' }),
        });

        expect(discovery.status).toBe(200);
        await expect(discovery.json()).resolves.toMatchObject({ deviceId: 'temp-desk' });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            action: 'pause_telemetry',
            status: 'completed',
        });
        expect(actions).toEqual([{ deviceId: 'temp-desk', action: 'pause_telemetry' }]);
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
                runDeviceScenario: runtime.runDeviceScenario,
                getDeviceScenarios: runtime.getDeviceScenarios,
            }),
        );
        openServers.push(server);

        try {
            const actionResponse = await fetch(
                `${serverUrl(server)}/dev/devices/temp-desk/scenarios`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'emit_next_reading' }),
                },
            );
            const roomResponse = await fetch(`${serverUrl(server)}/room`);

            expect(actionResponse.status).toBe(200);
            await expect(roomResponse.json()).resolves.toMatchObject({
                devices: expect.arrayContaining([
                    expect.objectContaining({ deviceId: 'temp-desk' }),
                ]),
            });
        } finally {
            runtime.stop();
        }
    });

    it('keeps development scenarios unavailable when no control handler is configured', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pause_telemetry' }),
        });

        expect(response.status).toBe(404);
    });

    it('rejects discovery responses that belong to a different device and leaves the old URL unavailable', async () => {
        const server = await listen(
            createRoomBffServer({
                ...createRoomBffConfig(),
                getDeviceScenarios() {
                    return {
                        deviceId: 'other-device',
                        scenarios: [{ action: 'pause_telemetry' }],
                    };
                },
            }),
        );
        openServers.push(server);

        const mismatch = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`);
        const removedRoute = await fetch(`${serverUrl(server)}/dev/scenarios/temperature`, {
            method: 'POST',
        });

        expect(mismatch.status).toBe(404);
        expect(removedRoute.status).toBe(404);
    });

    it('rejects unsupported development scenario actions', async () => {
        const server = await listen(createRoomBffServer(createScenarioBffConfig([])));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete_room' }),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: 'invalid_request',
        });
    });

    it('rejects development scenario requests without application/json', async () => {
        const server = await listen(createRoomBffServer(createScenarioBffConfig([])));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'pause_telemetry' }),
        });

        expect(response.status).toBe(415);
    });

    it('reports malformed development scenario JSON as an invalid request', async () => {
        const server = await listen(createRoomBffServer(createScenarioBffConfig([])));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{invalid',
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: 'invalid_request',
            message: 'Request body must be valid JSON.',
        });
    });

    it('reports scenario execution failures without treating them as invalid requests', async () => {
        const server = await listen(
            createRoomBffServer({
                ...createScenarioBffConfig([]),
                runDeviceScenario() {
                    throw new Error('Simulator unavailable.');
                },
            }),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pause_telemetry' }),
        });

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
            error: 'scenario_failed',
            message: 'Scenario could not be executed.',
        });
    });

    it('does not expose an invalid room projection through HTTP', async () => {
        const server = await listen(
            createRoomBffServer(
                createRoomBffConfig({
                    roomSnapshot: {
                        ...createRoomSnapshot(),
                        updatedAt: '2026-02-30T09:30:00Z',
                    },
                }),
            ),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room`);

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toMatchObject({
            error: 'invalid_server_response',
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
            revision: 0,
            sentAt: '2026-06-08T09:30:01Z',
            payload: expect.objectContaining(createRoomSnapshot()),
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

    it('streams a device delta after the initial room snapshot', async () => {
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
            messageType: 'device.updated',
            previousRevision: 0,
            revision: 1,
            sentAt: '2026-06-08T09:30:02Z',
            payload: {
                reportedState: {
                    temperature: 22.4,
                    temperatureUnit: 'celsius',
                },
            },
        });
    });

    it('streams only the changed device delta from the two-sensor runtime', async () => {
        const runtime = createTemperatureRoomRuntime({ intervalMs: 10_000 });
        runtime.start();
        const server = await listen(
            createRoomBffServer({
                getRoomSnapshot: runtime.getRoomSnapshot,
                getDiagnosticsSnapshot: runtime.getDiagnosticsSnapshot,
                subscribeRoomSnapshot: runtime.subscribeRoomSnapshot,
            }),
        );
        openServers.push(server);
        const socket = connectWebSocket(server);
        openSockets.push(socket);

        try {
            await expect(readRealtimeMessage(socket)).resolves.toMatchObject({
                messageType: 'room.snapshot',
                payload: {
                    devices: expect.arrayContaining([
                        expect.objectContaining({ deviceId: 'temp-desk' }),
                        expect.objectContaining({ deviceId: 'temp-window' }),
                    ]),
                },
            });

            runtime.runDeviceScenario('temp-window', 'emit_next_reading');

            await expect(readRealtimeMessage(socket)).resolves.toMatchObject({
                messageType: 'device.updated',
                previousRevision: 0,
                revision: 1,
                payload: {
                    deviceId: 'temp-window',
                    reportedState: { temperature: 20.2, temperatureUnit: 'celsius' },
                },
            });
        } finally {
            runtime.stop();
        }
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

function createScenarioBffConfig(actions: Array<{ deviceId: string; action: string }>) {
    return {
        ...createRoomBffConfig(),
        getDeviceScenarios(deviceId: string) {
            return deviceId === 'temp-desk'
                ? { deviceId, scenarios: [{ action: 'pause_telemetry' as const }] }
                : undefined;
        },
        runDeviceScenario(deviceId: string, action: TemperatureScenarioAction) {
            actions.push({ deviceId, action });
            return { action, status: 'completed' } as const;
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
        recentCommands: [],
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

async function listen(server: FastifyInstance): Promise<FastifyInstance> {
    await server.listen({
        port: 0,
        host: '127.0.0.1',
    });

    return server;
}

async function closeServer(server: FastifyInstance): Promise<void> {
    await server.close();
}

function serverUrl(server: FastifyInstance): string {
    const address = server.server.address() as AddressInfo;

    return `http://127.0.0.1:${address.port}`;
}

function websocketUrl(server: FastifyInstance): string {
    const address = server.server.address() as AddressInfo;

    return `ws://127.0.0.1:${address.port}/room/realtime`;
}

function connectWebSocket(server: FastifyInstance): WebSocket {
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
