import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import type { RoomBffSnapshot } from '@smart-room/contracts/room-bff';
import type { RoomBffRealtimeServerMessage } from '@smart-room/contracts/room-bff';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUserHistorySession } from '../history/user-history-session';

import { createRoomHistorySource } from './room-history-source';
import { connectRoomRealtime as connectTemperatureRealtime } from './room-realtime-client';

describe('connectTemperatureRealtime', () => {
    it('keeps the known generation when opening history during unknown storage so a replacement HTTP page cannot merge old live entries', async () => {
        const history = createRoomHistorySource();
        const connection = connectTemperatureRealtime(
            {
                ...createHandlers(),
                onHistoryUpdate: (update, baseline) => history.publish(update, baseline),
            },
            MockWebSocket,
        );
        history.setRequestBaseline(() => connection.requestBaseline());
        const fixtures = createUserHistoryFixtures();
        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({ userHistory: [fixtures.gap] }),
        );
        MockWebSocket.latest().emitMessage({
            messageType: 'platform.updated',
            previousRevision: 0,
            revision: 1,
            sentAt: '2026-06-08T09:30:02Z',
            payload: {
                storage: {
                    status: 'degraded',
                    changedAt: '2026-06-08T09:30:02Z',
                    reason: 'storage_write_failed',
                    historyGenerationId: null,
                    storedThroughSequence: null,
                },
            },
        } satisfies RoomBffRealtimeServerMessage);
        const baseline = history.source.getBaseline();

        if (!baseline) {
            throw new Error('Missing validated baseline');
        }

        const close = vi.spyOn(MockWebSocket.latest(), 'close');
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    ...fixtures.page,
                    pageSize: 50,
                    historyGenerationId: 'replacement',
                }),
            ),
        );
        const session = createUserHistorySession(fetcher, history.source.requestBaseline);
        const unsubscribe = history.source.subscribe((update) => session.acceptRealtime(update));
        session.acceptRealtime(baseline);
        await session.loadNextPage();
        expect(session.getState().status).toBe('waiting_for_baseline');
        expect(session.getState().items).not.toEqual(expect.arrayContaining(fixtures.page.items));
        expect(close).toHaveBeenCalledOnce();
        unsubscribe();
        session.close();
        connection.close();
    });
    beforeEach(() => {
        MockWebSocket.instances.length = 0;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    it('connects to the default realtime room endpoint', () => {
        connectTemperatureRealtime(createHandlers(), MockWebSocket);

        expect(MockWebSocket.instances[0]?.url).toBe('http://localhost:4310/room/realtime');
    });

    it('connects to the configured realtime room endpoint', () => {
        vi.stubEnv('VITE_ROOM_REALTIME_URL', 'http://127.0.0.1:4999/room/realtime');

        connectTemperatureRealtime(createHandlers(), MockWebSocket);

        expect(MockWebSocket.instances[0]?.url).toBe('http://127.0.0.1:4999/room/realtime');
    });

    it('emits the full room snapshot from a room snapshot message', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());

        expect(handlers.onSnapshot).toHaveBeenCalledWith(createRoomSnapshotMessage().payload);
    });

    it('forwards validated history before the snapshot handler can start HTTP', () => {
        const fixtures = createHistoryIdentityFixtures();
        const onHistoryUpdate = vi.fn();
        const handlers = {
            ...createHandlers(),
            onHistoryUpdate,
            onSnapshot: vi.fn(() => {
                expect(onHistoryUpdate).toHaveBeenCalled();
            }),
        };
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({ userHistory: [createUserHistoryFixtures().gap] }),
        );
        const deviceUpdate = createDeviceUpdatedMessage();

        if (deviceUpdate.messageType !== 'device.updated') {
            throw new Error('Fixture must contain a device update.');
        }

        MockWebSocket.latest().emitMessage({
            ...deviceUpdate,
            telemetrySample: fixtures.telemetrySample,
        } satisfies RoomBffRealtimeServerMessage);
        const feedUpdate = createDeviceUpdatedMessage({ previousRevision: 1, revision: 2 });

        if (feedUpdate.messageType !== 'device.updated') {
            throw new Error('Fixture must contain a device update.');
        }

        const addedFact = {
            ...createUserHistoryFixtures().availabilityChange,
            deviceId: 'temp-desk',
            deviceName: 'Desk Temperature',
        };
        MockWebSocket.latest().emitMessage({
            ...feedUpdate,
            userHistory: [addedFact],
        } satisfies RoomBffRealtimeServerMessage);

        expect(onHistoryUpdate).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                kind: 'baseline',
                userHistory: [createUserHistoryFixtures().gap],
            }),
            expect.anything(),
        );
        expect(onHistoryUpdate).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                kind: 'addition',
                telemetrySample: fixtures.telemetrySample,
            }),
            expect.anything(),
        );
        expect(onHistoryUpdate).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({ kind: 'addition', userHistory: [addedFact] }),
            expect.anything(),
        );
        expect(handlers.onInvalidMessage).not.toHaveBeenCalled();
    });

    it('signals an interrupted history stream before reconnecting', () => {
        const onHistoryUpdate = vi.fn();
        connectTemperatureRealtime({ ...createHandlers(), onHistoryUpdate }, MockWebSocket);
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitError();

        expect(onHistoryUpdate).toHaveBeenLastCalledWith({ kind: 'interrupted' });
    });

    it('replaces the event cache and publishes a history baseline on generation change', () => {
        const onHistoryUpdate = vi.fn();
        const handlers = { ...createHandlers(), onHistoryUpdate };
        connectTemperatureRealtime(handlers, MockWebSocket);
        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({ userHistory: [createUserHistoryFixtures().gap] }),
        );
        const replacementGap = {
            ...createUserHistoryFixtures().gap,
            recordId: `rec:v1:sha256:${'d'.repeat(64)}`,
            storageSequence: 1,
        };
        MockWebSocket.latest().emitMessage({
            messageType: 'platform.updated',
            previousRevision: 0,
            revision: 1,
            sentAt: '2026-06-08T09:31:00Z',
            payload: {
                storage: {
                    status: 'available',
                    changedAt: '2026-06-08T09:31:00Z',
                    historyGenerationId: 'replacement-generation',
                    storedThroughSequence: 1,
                },
                userHistory: [replacementGap],
            },
        } satisfies RoomBffRealtimeServerMessage);

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({ userHistory: [replacementGap] }),
        );
        expect(onHistoryUpdate).toHaveBeenLastCalledWith(
            expect.objectContaining({ kind: 'baseline', userHistory: [replacementGap] }),
            expect.anything(),
        );
    });

    it('rejects an SSE event whose name does not match its message contract', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });

        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage(), 'device.updated');

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('ignores undocumented unnamed SSE message events', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage(), 'message');

        expect(handlers.onSnapshot).not.toHaveBeenCalled();
        expect(handlers.onInvalidMessage).not.toHaveBeenCalled();
    });

    it('rejects a realtime snapshot whose timestamp is not canonical UTC', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            sentAt: '2026-06-08T11:30:01+02:00',
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('keeps an empty device collection in the room snapshot', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({
                devices: [],
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ devices: [] }));
    });

    it('reports invalid messages without rendering them', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            messageType: 'room.snapshot',
            sentAt: '2026-06-08T09:30:00Z',
            payload: {
                roomName: 'Smart Room',
            },
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it.each(createInvalidRenderableDevices())(
        'rejects $label before passing it to the UI',
        ({ device }) => {
            const handlers = createHandlers();
            connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });

            MockWebSocket.latest().emitMessage(createRoomSnapshotMessage({ devices: [device] }));

            expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
            expect(handlers.onSnapshot).not.toHaveBeenCalled();
            expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
        },
    );

    it('rejects a snapshot that omits the required recent-event cache', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            payload: (() => {
                const snapshotWithoutRecentEvents: Record<string, unknown> = {
                    ...createRoomSnapshotMessage().payload,
                };
                delete snapshotWithoutRecentEvents['userHistory'];

                return snapshotWithoutRecentEvents;
            })(),
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('reconnects after an invalid snapshot and accepts a later valid snapshot', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, {
            reconnectDelayMs: 1000,
        });

        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage({
            messageType: 'room.snapshot',
            sentAt: '2026-06-08T09:30:01Z',
            payload: {
                roomName: 'Smart Room',
            },
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');

        vi.advanceTimersByTime(1000);

        expect(MockWebSocket.instances).toHaveLength(2);

        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());

        expect(handlers.onSnapshot).toHaveBeenCalledTimes(2);
    });

    it('reports unsupported realtime message types as invalid messages', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage(
            {
                messageType: 'room.error',
                sentAt: '2026-06-08T09:30:00Z',
                payload: {
                    reason: 'internal_error',
                    message: 'Stream failed.',
                },
            },
            'room.snapshot',
        );

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('rejects a snapshot carrying a removed contract field', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            version: 1,
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('rejects a delta carrying a removed contract field without replacing the valid view', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage({
            ...createDeviceUpdatedMessage(),
            version: 1,
        });

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('reports snapshots with invalid timestamps as invalid messages', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            sentAt: 'not-a-timestamp',
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('applies a contiguous device delta with current state and health', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage(
            createDeviceUpdatedMessage({
                reportedState: { temperature: 23.1, temperatureUnit: 'celsius' },
                health: 'degraded',
                healthReason: 'partial_data',
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                devices: [
                    expect.objectContaining({
                        reportedState: { temperature: 23.1, temperatureUnit: 'celsius' },
                        health: 'degraded',
                    }),
                ],
            }),
        );
    });

    it('applies a contiguous platform storage delta without changing the room devices', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage({
            messageType: 'platform.updated',
            previousRevision: 0,
            revision: 1,
            sentAt: '2026-06-08T09:30:02Z',
            payload: {
                storage: {
                    status: 'degraded',
                    changedAt: '2026-06-08T09:30:02Z',
                    reason: 'storage_write_failed',
                    historyGenerationId: null,
                    storedThroughSequence: null,
                },
            },
        } satisfies RoomBffRealtimeServerMessage);

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                platform: expect.objectContaining({
                    storage: expect.objectContaining({ status: 'degraded' }),
                }),
                devices: [expect.objectContaining({ deviceId: 'temp-desk' })],
            }),
        );
    });

    it('retains the event cache across repeated null-generation platform updates', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);
        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({ userHistory: [createUserHistoryFixtures().gap] }),
        );
        MockWebSocket.latest().emitMessage({
            messageType: 'platform.updated',
            previousRevision: 0,
            revision: 1,
            sentAt: '2026-06-08T09:30:02Z',
            payload: {
                storage: {
                    status: 'degraded',
                    changedAt: '2026-06-08T09:30:02Z',
                    reason: 'storage_write_failed',
                    historyGenerationId: null,
                    storedThroughSequence: null,
                },
            },
        } satisfies RoomBffRealtimeServerMessage);
        MockWebSocket.latest().emitMessage({
            messageType: 'platform.updated',
            previousRevision: 1,
            revision: 2,
            sentAt: '2026-06-08T09:30:03Z',
            payload: {
                storage: {
                    status: 'recovering',
                    changedAt: '2026-06-08T09:30:03Z',
                    reason: 'storage_recovery_in_progress',
                    historyGenerationId: null,
                    storedThroughSequence: null,
                },
            },
        } satisfies RoomBffRealtimeServerMessage);

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({ userHistory: [createUserHistoryFixtures().gap] }),
        );
    });

    it('merges a durable recovery gap from a platform delta without reconnecting', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage({
            messageType: 'platform.updated',
            previousRevision: 0,
            revision: 1,
            sentAt: '2026-09-03T08:00:01Z',
            payload: {
                storage: {
                    status: 'available',
                    changedAt: '2026-09-03T08:00:01Z',
                    historyGenerationId: 'generation-test',
                    storedThroughSequence: 1,
                },
                userHistory: [
                    {
                        recordId: `rec:v1:sha256:${'1'.repeat(64)}`,
                        occurredAt: '2026-09-03T08:00:01.000Z',
                        durability: 'durable',
                        storageSequence: 1,
                        source: 'backend',
                        outageStartedAt: '2026-09-03T08:00:00.000Z',
                        outageEndedAt: '2026-09-03T08:00:01.000Z',
                        kind: 'history_gap',
                    },
                ],
            },
        } satisfies RoomBffRealtimeServerMessage);

        expect(handlers.onInvalidMessage).not.toHaveBeenCalled();
        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                userHistory: [expect.objectContaining({ kind: 'history_gap' })],
            }),
        );
    });

    it('rejects a schema-valid device delta that breaks active command references', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({
                devices: [createLedDevice('cmd-1')],
                activeCommands: [createPendingCommand()],
            }),
        );
        MockWebSocket.latest().emitMessage({
            ...createDeviceUpdatedMessage(),
            payload: createLedDevice('cmd-missing'),
        });

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('replaces only the matching device in a multi-device room snapshot', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);
        MockWebSocket.latest().emitMessage(
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
        MockWebSocket.latest().emitMessage(
            createDeviceUpdatedMessage({
                deviceId: 'temp-window',
                reportedState: { temperature: 19.4, temperatureUnit: 'celsius' },
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                devices: [
                    expect.objectContaining({
                        deviceId: 'temp-desk',
                        reportedState: { temperature: 22.4, temperatureUnit: 'celsius' },
                    }),
                    expect.objectContaining({
                        deviceId: 'temp-window',
                        reportedState: { temperature: 19.4, temperatureUnit: 'celsius' },
                    }),
                ],
            }),
        );
    });

    it('merges feed facts carried by a device update', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        const recentEvent = {
            ...createUserHistoryFixtures().availabilityChange,
            deviceId: 'temp-desk',
            deviceName: 'Desk Temperature',
        };

        MockWebSocket.latest().emitMessage({
            ...createDeviceUpdatedMessage(),
            userHistory: [recentEvent],
        });

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({ userHistory: [recentEvent] }),
        );
    });

    it('applies a contiguous command delta without replacing the reported LED state', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);
        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({
                devices: [createLedDevice()],
            }),
        );
        MockWebSocket.latest().emitMessage(createCommandsUpdatedMessage());

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                devices: [expect.objectContaining({ reportedState: { power: 'off' } })],
                activeCommands: [
                    expect.objectContaining({
                        commandId: 'cmd-1',
                        requestedState: { power: 'on' },
                        status: 'pending',
                    }),
                ],
            }),
        );
    });

    it('applies one atomic command update without losing another device command history', () => {
        const handlers = createHandlers();
        const sideDevice = { ...createLedDevice(), deviceId: 'led-side', name: 'Side LED' };
        const sideCommand = {
            ...createConfirmedCommand(),
            commandId: 'cmd-side',
            deviceId: 'led-side',
        };
        connectTemperatureRealtime(handlers, MockWebSocket);
        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({ devices: [createLedDevice(), sideDevice] }),
        );
        MockWebSocket.latest().emitMessage(
            createCommandsUpdatedMessage({
                devices: [createLedDevice('cmd-1'), sideDevice],
                activeCommands: [createPendingCommand()],
                recentCommands: [sideCommand],
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                devices: [
                    expect.objectContaining({ deviceId: 'led-main', activeCommandId: 'cmd-1' }),
                    expect.objectContaining({ deviceId: 'led-side' }),
                ],
                activeCommands: [expect.objectContaining({ commandId: 'cmd-1' })],
                recentCommands: [expect.objectContaining({ commandId: 'cmd-side' })],
            }),
        );
    });

    it.each([
        {
            label: 'removes a configured device',
            devices: [createLedDevice('cmd-1')],
        },
        {
            label: 'adds an unknown device',
            devices: [
                createLedDevice('cmd-1'),
                { ...createLedDevice(), deviceId: 'led-side', name: 'Side LED' },
                { ...createLedDevice(), deviceId: 'led-extra', name: 'Extra LED' },
            ],
        },
        {
            label: 'duplicates a device ID',
            devices: [
                createLedDevice('cmd-1'),
                { ...createLedDevice(), deviceId: 'led-main', name: 'Duplicate LED' },
            ],
        },
    ])('rejects a command update that $label without replacing the valid view', ({ devices }) => {
        const handlers = createHandlers();
        const sideDevice = { ...createLedDevice(), deviceId: 'led-side', name: 'Side LED' };
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({ devices: [createLedDevice(), sideDevice] }),
        );
        MockWebSocket.latest().emitMessage(
            createCommandsUpdatedMessage({
                devices,
                activeCommands: [createPendingCommand()],
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('rejects a non-contiguous command delta without replacing the valid view', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({ devices: [createLedDevice()] }),
        );
        MockWebSocket.latest().emitMessage(
            createCommandsUpdatedMessage({ previousRevision: 1, revision: 2 }),
        );

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('rejects a malformed command delta without replacing the valid view', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({ devices: [createLedDevice()] }),
        );
        MockWebSocket.latest().emitMessage({
            ...createCommandsUpdatedMessage(),
            version: 1,
        });

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('keeps the confirmed LED state separate when a command becomes terminal', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);
        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({
                devices: [createLedDevice('cmd-1')],
                activeCommands: [createPendingCommand()],
            }),
        );
        MockWebSocket.latest().emitMessage(
            createCommandsUpdatedMessage({
                activeCommands: [],
                recentCommands: [createConfirmedCommand()],
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                devices: [expect.objectContaining({ reportedState: { power: 'off' } })],
                activeCommands: [],
                recentCommands: [expect.objectContaining({ status: 'confirmed' })],
            }),
        );
    });

    it('preserves the valid view and reconnects after a revision gap', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage(
            createDeviceUpdatedMessage({ previousRevision: 1, revision: 2 }),
        );

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('rejects a delta for an unknown device without replacing the valid view', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage(createDeviceUpdatedMessage({ deviceId: 'temp-window' }));

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('rejects an unexpected snapshot after the baseline instead of resetting the revision', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('reports connection status and reconnects after the stream closes', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, {
            reconnectDelayMs: 1000,
        });

        expect(handlers.onConnectionStatus).toHaveBeenCalledWith('connecting');

        MockWebSocket.latest().emitOpen();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('connecting');

        MockWebSocket.latest().emitError();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
        expect(MockWebSocket.instances).toHaveLength(1);

        vi.advanceTimersByTime(1000);

        expect(MockWebSocket.instances).toHaveLength(2);
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('ignores late WebSocket events after the connection is closed by the client', () => {
        const handlers = createHandlers();
        const connection = connectTemperatureRealtime(handlers, MockWebSocket);
        const socket = MockWebSocket.latest();

        connection.close();
        socket.emitOpen();
        socket.emitMessage(createRoomSnapshotMessage());
        socket.emitError();
        socket.emitClose();
        vi.advanceTimersByTime(1000);

        expect(handlers.onSnapshot).not.toHaveBeenCalled();
        expect(handlers.onInvalidMessage).not.toHaveBeenCalled();
        expect(MockWebSocket.instances).toHaveLength(1);
    });
});

function createHandlers() {
    return {
        onConnectionStatus: vi.fn(),
        onSnapshot: vi.fn(),
        onInvalidMessage: vi.fn(),
    };
}

function createInvalidRenderableDevices(): readonly {
    label: string;
    device: RoomBffSnapshot['devices'][number];
}[] {
    return [
        {
            label: 'a temperature device without an observation status',
            device: { ...createTemperatureDevice(), observationStatus: {} },
        },
        {
            label: 'a temperature reading without a timestamp',
            device: {
                ...createTemperatureDevice(),
                observationStatus: { temperature: { freshness: 'unknown', durability: 'durable' } },
            },
        },
        {
            label: 'an LED with an unsupported reported power state',
            device: { ...createLedDevice(), reportedState: { power: 'standby' } },
        },
    ];
}

function createRoomSnapshotMessage({
    devices = [createTemperatureDevice()],
    activeCommands = [],
    recentCommands = [],
    userHistory = [],
}: {
    devices?: RoomBffRealtimeServerMessage extends { payload: infer Payload }
        ? Payload extends { devices: infer Devices }
            ? Devices
            : never
        : never;
    activeCommands?: RoomBffSnapshot['activeCommands'];
    recentCommands?: RoomBffSnapshot['recentCommands'];
    userHistory?: RoomBffSnapshot['userHistory'];
} = {}): RoomBffRealtimeServerMessage {
    return {
        messageType: 'room.snapshot',
        revision: 0,
        sentAt: '2026-06-08T09:30:01Z',
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-06-08T09:30:00Z',
            devices,
            activeCommands,
            recentCommands,
            userHistory,
            platform: {
                storage: {
                    status: 'available',
                    changedAt: '2026-06-08T09:30:00Z',
                    historyGenerationId: 'generation-test',
                    storedThroughSequence: 0,
                },
            },
        },
    };
}

function createDeviceUpdatedMessage({
    previousRevision = 0,
    revision = 1,
    deviceId = 'temp-desk',
    health,
    healthReason,
    reportedState = { temperature: 22.8, temperatureUnit: 'celsius' },
}: {
    previousRevision?: number;
    revision?: number;
    deviceId?: string;
    health?: RoomBffSnapshot['devices'][number]['health'];
    healthReason?: string;
    reportedState?: { temperature: number; temperatureUnit: 'celsius' };
} = {}): RoomBffRealtimeServerMessage {
    return {
        messageType: 'device.updated',
        previousRevision,
        revision,
        sentAt: '2026-06-08T09:30:02Z',
        payload: {
            ...createTemperatureDevice(),
            deviceId,
            ...(health ? { health } : {}),
            ...(healthReason ? { healthReason } : {}),
            reportedState,
        },
    };
}

function createTemperatureDevice(): RoomBffSnapshot['devices'][number] {
    return {
        deviceId: 'temp-desk',
        name: 'Desk Temperature',
        role: 'temperature-sensor',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        healthDurability: 'durable',
        reportedState: {
            temperature: 22.4,
            temperatureUnit: 'celsius',
        },
        commandAvailability: {
            policy: 'block',
            reason: 'read_only_device',
        },
        observationStatus: {
            temperature: {
                freshness: 'fresh',
                lastObservedAt: '2026-06-08T09:30:00Z',
                durability: 'durable',
            },
        },
    };
}

function createLedDevice(activeCommandId?: string): RoomBffSnapshot['devices'][number] {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        healthDurability: 'durable',
        reportedState: { power: 'off' },
        commandAvailability: { policy: 'allow' },
        observationStatus: {
            power: {
                freshness: 'fresh',
                lastObservedAt: '2026-06-08T09:30:00Z',
                durability: 'durable',
            },
        },
        ...(activeCommandId ? { activeCommandId } : {}),
    };
}

function createCommandsUpdatedMessage({
    previousRevision = 0,
    revision = 1,
    activeCommands = [createPendingCommand()],
    recentCommands = [],
    devices = [createLedDevice(activeCommands[0]?.commandId)],
}: {
    previousRevision?: number;
    revision?: number;
    devices?: RoomBffSnapshot['devices'];
    activeCommands?: RoomBffSnapshot['activeCommands'];
    recentCommands?: RoomBffSnapshot['recentCommands'];
} = {}): RoomBffRealtimeServerMessage {
    return {
        messageType: 'commands.updated',
        previousRevision,
        revision,
        sentAt: '2026-06-08T09:30:02Z',
        payload: {
            devices,
            activeCommands,
            recentCommands,
        },
    };
}

function createPendingCommand(): RoomBffSnapshot['activeCommands'][number] {
    return {
        commandId: 'cmd-1',
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'pending',
        requestedState: { power: 'on' },
        requestedAt: '2026-06-08T09:30:00Z',
        delivery: {
            status: 'handed_off',
            dispatchedAt: '2026-06-08T09:30:01Z',
            deadlineAt: '2026-06-08T09:30:06Z',
        },
        durability: 'durable',
        lifecycleDurability: 'durable',
    };
}

function createConfirmedCommand(): RoomBffSnapshot['recentCommands'][number] {
    return {
        commandId: 'cmd-1',
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'confirmed',
        requestedState: { power: 'on' },
        requestedAt: '2026-06-08T09:30:00Z',
        delivery: {
            status: 'handed_off',
            dispatchedAt: '2026-06-08T09:30:01Z',
            deadlineAt: '2026-06-08T09:30:06Z',
        },
        confirmedAt: '2026-06-08T09:30:03Z',
        durability: 'durable',
        lifecycleDurability: 'durable',
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

    emitOpen(): void {
        this.dispatchEvent(new Event('open'));
    }

    emitError(): void {
        this.dispatchEvent(new Event('error'));
    }

    emitClose(): void {
        this.dispatchEvent(new Event('close'));
    }

    emitMessage(data: unknown, eventType = getRealtimeEventType(data)): void {
        this.dispatchEvent(
            new MessageEvent(eventType, {
                data: JSON.stringify(data),
            }),
        );
    }
}

function getRealtimeEventType(data: unknown): string {
    if (typeof data === 'object' && data !== null && 'messageType' in data) {
        const messageType = data.messageType;

        if (typeof messageType === 'string') {
            return messageType;
        }
    }

    return 'room.snapshot';
}
