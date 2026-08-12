import type { AddressInfo } from 'node:net';

import type { DeviceScenarioAction } from '@smart-room/contracts/development';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type { RoomRealtimeServerMessage } from '@smart-room/contracts/realtime';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { EventProcessingDiagnosticsSnapshot } from '../platform/event-processing/event-processing-diagnostics';
import { createTemperatureRoomRuntime } from '../runtime/temperature-room-runtime';

import { createRoomBffServer } from './room-bff';

describe('createRoomBffServer', () => {
    const openServers: FastifyInstance[] = [];
    const openStreams: SseConnection[] = [];

    afterEach(async () => {
        openStreams.forEach((stream) => stream.close());
        openStreams.length = 0;
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
                        health: 'degraded',
                        healthReason: 'partial_data',
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
                    health: 'degraded',
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

    it('accepts a valid command request without treating it as device confirmation', async () => {
        const requests: unknown[] = [];
        const server = await listen(
            createRoomBffServer({
                ...createRoomBffConfig(),
                requestCommand(request) {
                    requests.push(request);

                    return { commandId: 'cmd-led-1', status: 'accepted' } as const;
                },
            }),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room/commands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        });

        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toEqual({
            commandId: 'cmd-led-1',
            status: 'accepted',
        });
        expect(requests).toEqual([
            { deviceId: 'led-main', commandType: 'set.power', requestedState: { power: 'on' } },
        ]);
    });

    it('rejects malformed or unsupported command requests at the HTTP boundary', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const malformed = await fetch(`${serverUrl(server)}/room/commands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: 'led-main', commandType: 'set.level' }),
        });
        const nonJson = await fetch(`${serverUrl(server)}/room/commands`, {
            method: 'POST',
            body: JSON.stringify({ deviceId: 'led-main' }),
        });

        expect(malformed.status).toBe(400);
        await expect(malformed.json()).resolves.toMatchObject({ error: 'invalid_request' });
        expect(nonJson.status).toBe(415);
        await expect(nonJson.json()).resolves.toMatchObject({ error: 'unsupported_media_type' });
    });

    it('keeps command validation errors in the API error contract when a query is present', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room/commands?source=dashboard`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: 'led-main', commandType: 'set.level' }),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: 'invalid_request',
            message: 'Request body does not match a supported command.',
        });
    });

    it('maps active-command rejection to 409', async () => {
        const server = await listen(
            createRoomBffServer({
                ...createRoomBffConfig(),
                requestCommand() {
                    return {
                        commandId: 'cmd-led-2',
                        status: 'rejected',
                        reason: 'command_already_active',
                        message: 'Device already has an active command.',
                    } as const;
                },
            }),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room/commands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({ status: 'rejected' });
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

    it('sends an initial room snapshot over the SSE stream', async () => {
        const harness = createRoomBffHarness({
            sentAt: ['2026-06-08T09:30:01Z'],
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);

        const stream = await connectSse(server);
        openStreams.push(stream);

        expect(stream.contentType).toContain('text/event-stream');
        expect(stream.accessControlAllowOrigin).toBe('*');
        expect(stream.cacheControl).toBe('no-cache, no-transform');
        expect(stream.connection).toBe('keep-alive');
        const frame = await readRealtimeFrame(stream);

        expect(frame.event).toBe('room.snapshot');
        expect(frame.id).toBeUndefined();
        expect(frame.message).toEqual({
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

        const stream = await connectSse(server);
        openStreams.push(stream);

        await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
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

        const stream = await connectSse(server);
        openStreams.push(stream);
        await readRealtimeMessage(stream);

        harness.publishRoomSnapshot(
            createRoomSnapshot({
                temperature: 22.4,
                updatedAt: '2026-06-08T09:30:02Z',
            }),
        );

        await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
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

    it('streams sequential command projection deltas for the affected device', async () => {
        const harness = createRoomBffHarness({
            roomSnapshot: createLedRoomSnapshot(),
            sentAt: ['2026-06-08T09:30:01Z', '2026-06-08T09:30:02Z', '2026-06-08T09:30:03Z'],
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);
        const stream = await connectSse(server);
        openStreams.push(stream);
        await readRealtimeMessage(stream);

        harness.publishRoomSnapshot(createLedRoomSnapshot({ status: 'accepted' }));
        await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
            messageType: 'commands.updated',
            previousRevision: 0,
            revision: 1,
            payload: { activeCommands: [expect.objectContaining({ status: 'accepted' })] },
        });

        harness.publishRoomSnapshot(createLedRoomSnapshot({ status: 'confirmed' }));
        await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
            messageType: 'commands.updated',
            previousRevision: 1,
            revision: 2,
            payload: { recentCommands: [expect.objectContaining({ status: 'confirmed' })] },
        });
    });

    it('streams global command collections atomically for multiple controllable devices', async () => {
        const harness = createRoomBffHarness({
            roomSnapshot: createTwoLedRoomSnapshot('accepted'),
            sentAt: ['2026-06-08T09:30:01Z', '2026-06-08T09:30:03Z'],
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);
        const stream = await connectSse(server);
        openStreams.push(stream);
        await readRealtimeMessage(stream);

        harness.publishRoomSnapshot(createTwoLedRoomSnapshot('confirmed'));

        await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
            messageType: 'commands.updated',
            previousRevision: 0,
            revision: 1,
            payload: {
                devices: expect.arrayContaining([
                    expect.objectContaining({ deviceId: 'led-main' }),
                    expect.objectContaining({ deviceId: 'led-side' }),
                ]),
                activeCommands: [],
                recentCommands: expect.arrayContaining([
                    expect.objectContaining({ commandId: 'cmd-led-1', status: 'confirmed' }),
                    expect.objectContaining({ commandId: 'cmd-led-side', status: 'confirmed' }),
                ]),
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
        const stream = await connectSse(server);
        openStreams.push(stream);

        try {
            await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
                messageType: 'room.snapshot',
                payload: {
                    devices: expect.arrayContaining([
                        expect.objectContaining({ deviceId: 'temp-desk' }),
                        expect.objectContaining({ deviceId: 'temp-window' }),
                    ]),
                },
            });

            runtime.runDeviceScenario('temp-window', 'emit_next_reading');

            await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
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

    it('removes realtime snapshot subscriptions when the SSE client closes', async () => {
        const harness = createRoomBffHarness({
            sentAt: ['2026-06-08T09:30:01Z'],
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);

        const stream = await connectSse(server);
        openStreams.push(stream);
        await readRealtimeMessage(stream);

        expect(harness.listenerCount()).toBe(1);

        await stream.close();
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
        runDeviceScenario(deviceId: string, action: DeviceScenarioAction) {
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
    health = 'healthy',
    healthReason,
    temperature = 22,
    updatedAt = '2026-06-08T09:30:00Z',
}: {
    health?: RoomSnapshotProjection['devices'][number]['health'];
    healthReason?: string;
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
                availability: 'online',
                availabilityChangedAt: '2026-06-08T09:30:00Z',
                health,
                healthChangedAt: '2026-06-08T09:30:00Z',
                ...(healthReason ? { healthReason } : {}),
                reportedState: {
                    temperature,
                    temperatureUnit: 'celsius',
                },
                commandAvailability: {
                    policy: 'block',
                    reason: 'read_only_device',
                },
                observationStatus: {
                    temperature: { freshness: 'fresh', lastObservedAt: '2026-06-08T09:30:00Z' },
                },
            },
        ],
        activeCommands: [],
        recentCommands: [],
    };
}

function createLedRoomSnapshot({
    status,
}: {
    status?: 'accepted' | 'confirmed';
} = {}): RoomSnapshotProjection {
    const command = {
        commandId: 'cmd-led-1',
        deviceId: 'led-main',
        commandType: 'set.power' as const,
        requestedState: { power: 'on' as const },
        requestedAt: '2026-06-08T09:30:00Z',
    };

    return {
        roomName: 'Smart Room',
        updatedAt: status ? '2026-06-08T09:30:02Z' : '2026-06-08T09:30:00Z',
        devices: [
            {
                deviceId: 'led-main',
                name: 'Main LED',
                role: 'led-output',
                availability: 'online',
                availabilityChangedAt: '2026-06-08T09:30:00Z',
                health: 'healthy',
                healthChangedAt: '2026-06-08T09:30:00Z',
                reportedState: { power: status === 'confirmed' ? 'on' : 'off' },
                commandAvailability: { policy: 'allow' },
                observationStatus: {
                    power: { freshness: 'unknown', lastObservedAt: '2026-06-08T09:30:00Z' },
                },
                ...(status === 'accepted' ? { activeCommandId: command.commandId } : {}),
            },
        ],
        activeCommands: status === 'accepted' ? [{ ...command, status: 'accepted' }] : [],
        recentCommands:
            status === 'confirmed'
                ? [
                      {
                          ...command,
                          status: 'confirmed',
                          dispatchedAt: '2026-06-08T09:30:01Z',
                          confirmedAt: '2026-06-08T09:30:02Z',
                      },
                  ]
                : [],
    };
}

function createTwoLedRoomSnapshot(status: 'accepted' | 'confirmed'): RoomSnapshotProjection {
    const snapshot = createLedRoomSnapshot({ status });
    const sideCommand = {
        commandId: 'cmd-led-side',
        deviceId: 'led-side',
        commandType: 'set.power' as const,
        requestedState: { power: 'off' as const },
        requestedAt: '2026-06-08T09:29:58Z',
        dispatchedAt: '2026-06-08T09:29:59Z',
        confirmedAt: '2026-06-08T09:30:00Z',
        status: 'confirmed' as const,
    };

    return {
        ...snapshot,
        devices: [
            ...snapshot.devices,
            {
                deviceId: 'led-side',
                name: 'Side LED',
                role: 'led-output',
                availability: 'online',
                availabilityChangedAt: '2026-06-08T09:30:00Z',
                health: 'healthy',
                healthChangedAt: '2026-06-08T09:30:00Z',
                reportedState: { power: 'off' },
                commandAvailability: { policy: 'allow' },
                observationStatus: {
                    power: { freshness: 'unknown', lastObservedAt: '2026-06-08T09:30:00Z' },
                },
            },
        ],
        recentCommands: [...snapshot.recentCommands, sideCommand],
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

interface SseConnection {
    accessControlAllowOrigin: string | null;
    contentType: string | null;
    cacheControl: string | null;
    connection: string | null;
    close(): Promise<void>;
    readFrame(): Promise<SseFrame>;
}

interface SseFrame {
    event: string | undefined;
    id: string | undefined;
    message: RoomRealtimeServerMessage;
}

async function connectSse(server: FastifyInstance): Promise<SseConnection> {
    const response = await fetch(`${serverUrl(server)}/room/realtime`);

    if (!response.body) {
        throw new Error('SSE response did not include a body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    return {
        accessControlAllowOrigin: response.headers.get('access-control-allow-origin'),
        contentType: response.headers.get('content-type'),
        cacheControl: response.headers.get('cache-control'),
        connection: response.headers.get('connection'),
        async close() {
            try {
                await reader.cancel();
            } catch {
                // The stream may already have been cancelled during test cleanup.
            }
        },
        async readFrame() {
            while (true) {
                const boundary = buffer.indexOf('\n\n');

                if (boundary !== -1) {
                    const frame = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    const data = frame
                        .split('\n')
                        .find((line) => line.startsWith('data: '))
                        ?.slice('data: '.length);

                    if (data) {
                        return {
                            event: frame
                                .split('\n')
                                .find((line) => line.startsWith('event: '))
                                ?.slice('event: '.length),
                            id: frame
                                .split('\n')
                                .find((line) => line.startsWith('id: '))
                                ?.slice('id: '.length),
                            message: JSON.parse(data) as RoomRealtimeServerMessage,
                        };
                    }
                }

                const result = await reader.read();

                if (result.done) {
                    throw new Error('SSE stream closed before a realtime message arrived.');
                }

                buffer += decoder.decode(result.value, { stream: true });
            }
        },
    };
}

function readRealtimeMessage(stream: SseConnection): Promise<RoomRealtimeServerMessage> {
    return stream.readFrame().then((frame) => frame.message);
}

function readRealtimeFrame(stream: SseConnection): Promise<SseFrame> {
    return stream.readFrame();
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
