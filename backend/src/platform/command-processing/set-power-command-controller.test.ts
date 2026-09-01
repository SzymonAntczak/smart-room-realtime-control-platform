import type { PlatformEvent } from '@smart-room/contracts/events';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { describe, expect, it } from 'vitest';

import type { EventProcessingResult } from '../event-processing/event-processor';
import type { CommandDispatchResult } from '../ports/set-power-command-dispatcher';

import { createSetPowerCommandController } from './set-power-command-controller';

describe('createSetPowerCommandController', () => {
    it('surfaces an unclassified dispatcher exception without fabricating a lifecycle fact', () => {
        const events: PlatformEvent[] = [];
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch() {
                            throw new Error('transport unavailable');
                        },
                    },
                },
            ],
            emitEvent(event) {
                events.push(event);

                return acceptedEvent();
            },
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => availableLedSnapshot,
            clock: { now: () => '2026-08-05T10:00:00Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout: () => undefined },
            generateCommandId: () => 'cmd-led-1',
            generateEventId: createEventIdGenerator(),
        });

        expect(() =>
            controller.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        ).toThrow('transport unavailable');
        expect(events.map((event) => event.eventType)).toEqual(['command.requested']);
    });

    it('rejects an invalid dispatcher result instead of fabricating a handoff', () => {
        const events: PlatformEvent[] = [];
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch() {
                            return undefined as unknown as CommandDispatchResult;
                        },
                    },
                },
            ],
            emitEvent(event) {
                events.push(event);

                return acceptedEvent();
            },
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => availableLedSnapshot,
            clock: { now: () => '2026-08-05T10:00:00Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout: () => undefined },
            generateCommandId: () => 'cmd-led-invalid-result',
        });

        expect(() =>
            controller.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        ).toThrow('Dispatcher returned an invalid command handoff result.');
        expect(events.map((event) => event.eventType)).toEqual(['command.requested']);
    });

    it('keeps unknown-device and recovering requests outside lifecycle admission', () => {
        const cases: Array<{ snapshot: RoomSnapshotProjection; expected: object }> = [
            {
                snapshot: {
                    ...availableLedSnapshot,
                    devices: [],
                },
                expected: { error: 'unknown_device', message: 'Device was not found.' },
            },
            {
                snapshot: {
                    ...availableLedSnapshot,
                    platform: {
                        storage: {
                            status: 'recovering' as const,
                            changedAt: '2026-08-05T10:00:00Z',
                            reason: 'storage_recovering',
                            historyGenerationId: 'generation-test',
                            storedThroughSequence: 0,
                        },
                    },
                },
                expected: {
                    error: 'platform_recovering',
                    message:
                        'Command admission is temporarily unavailable during storage recovery.',
                    retryable: true,
                },
            },
        ];

        for (const { snapshot, expected } of cases) {
            const events: PlatformEvent[] = [];
            const controller = createSetPowerCommandController({
                routes: [],
                emitEvent(event) {
                    events.push(event);

                    return acceptedEvent();
                },
                createDispatchScope: immediateDispatchScope,
                getRoomSnapshot: () => snapshot,
                clock: { now: () => '2026-08-05T10:00:00Z' },
                commandTimer: { setTimeout: () => 1, clearTimeout() {} },
                generateCommandId: () => {
                    throw new Error('Pre-admission failures must not allocate a command id.');
                },
            });

            expect(
                controller.requestCommand({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                }),
            ).toEqual(expected);
            expect(events).toEqual([]);
        }
    });

    it('dispatches through the route configured for a device other than led-main', () => {
        const events: PlatformEvent[] = [];
        const dispatchedCommands: unknown[] = [];
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-reading',
                    target: 'hardware-adapter',
                    dispatcher: {
                        dispatch(command) {
                            dispatchedCommands.push(command);

                            return {
                                status: 'handed_off' as const,
                                handedOffAt: '2026-08-05T10:00:00Z',
                            };
                        },
                    },
                },
            ],
            emitEvent(event) {
                events.push(event);

                return acceptedEvent();
            },
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => availableLedSnapshotFor('led-reading'),
            clock: { now: () => '2026-08-05T10:00:00Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout: () => undefined },
            generateCommandId: () => 'cmd-led-reading-1',
            generateEventId: createEventIdGenerator(),
        });

        expect(
            controller.requestCommand({
                deviceId: 'led-reading',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        ).toEqual({
            commandId: 'cmd-led-reading-1',
            status: 'accepted',
            durability: 'durable',
            lifecycleDurability: 'durable',
        });
        expect(dispatchedCommands).toEqual([
            expect.objectContaining({ commandId: 'cmd-led-reading-1', deviceId: 'led-reading' }),
        ]);
        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    eventType: 'command.dispatched',
                    payload: { commandType: 'set.power', target: 'hardware-adapter' },
                }),
            ]),
        );
    });

    it('rejects an otherwise available device without a configured route', () => {
        const events: PlatformEvent[] = [];
        const controller = createSetPowerCommandController({
            routes: [],
            emitEvent(event) {
                events.push(event);

                return acceptedEvent();
            },
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => availableLedSnapshotFor('led-unrouted'),
            clock: { now: () => '2026-08-05T10:00:00Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout: () => undefined },
            generateCommandId: () => 'cmd-led-unrouted-1',
        });

        expect(
            controller.requestCommand({
                deviceId: 'led-unrouted',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        ).toEqual({
            commandId: 'cmd-led-unrouted-1',
            status: 'rejected',
            reason: 'unsupported_command',
            message: 'Device does not support this command.',
            durability: 'volatile',
            lifecycleDurability: 'volatile',
        });
        expect(events).toEqual([
            expect.objectContaining({
                eventType: 'command.failed',
                commandId: 'cmd-led-unrouted-1',
                payload: expect.objectContaining({ reason: 'unsupported_command' }),
            }),
        ]);
    });

    it('keeps one fixed deadline across an uncertain durable retry and persists each delivery result', () => {
        const events: PlatformEvent[] = [];
        const mutations: unknown[] = [];
        const scheduled: Array<{ delayMs: number; callback: () => void }> = [];
        let attempts = 0;
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch() {
                            attempts += 1;

                            return attempts === 1
                                ? { status: 'uncertain' as const, reason: 'transport_ack_lost' }
                                : {
                                      status: 'handed_off' as const,
                                      handedOffAt: '2026-08-05T10:00:00.500Z',
                                  };
                        },
                    },
                },
            ],
            emitEvent(event, mutation) {
                events.push(event);
                mutations.push(mutation);

                return acceptedEvent();
            },
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => availableLedSnapshot,
            clock: { now: () => '2026-08-05T10:00:00Z' },
            commandTimer: {
                setTimeout(callback, delayMs) {
                    scheduled.push({ callback, delayMs });

                    return scheduled.length;
                },
                clearTimeout() {},
            },
            enableAutomaticRetry: true,
            generateCommandId: () => 'cmd-uncertain-1',
            generateEventId: createEventIdGenerator(),
        });

        controller.requestCommand({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });

        expect(events.map((event) => event.eventType)).toEqual([
            'command.requested',
            'command.delivery_uncertain',
        ]);
        expect(scheduled.filter((entry) => entry.delayMs === 500)).toHaveLength(1);
        const firstMutation = mutations[1] as {
            kind: 'upsert';
            intent: { state: string; deadlineAt?: string; firstAttemptedAt?: string };
        };
        expect(firstMutation).toMatchObject({
            kind: 'upsert',
            intent: {
                state: 'uncertain',
                firstAttemptedAt: '2026-08-05T10:00:00Z',
                deadlineAt: '2026-08-05T10:00:05.000Z',
            },
        });

        scheduled.find((entry) => entry.delayMs === 500)?.callback();

        expect(attempts).toBe(2);
        expect(events.at(-1)).toMatchObject({ eventType: 'command.dispatched' });
        expect(mutations.at(-1)).toMatchObject({
            kind: 'upsert',
            intent: { state: 'delivered', deadlineAt: '2026-08-05T10:00:05.000Z' },
        });
    });

    it('keeps automatic durable retry disabled by the composed controller default', () => {
        const scheduled: number[] = [];
        let attempts = 0;
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch() {
                            attempts += 1;

                            return { status: 'uncertain' as const, reason: 'transport_ack_lost' };
                        },
                    },
                },
            ],
            emitEvent: () => acceptedEvent(),
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => availableLedSnapshot,
            clock: { now: () => '2026-08-05T10:00:00Z' },
            commandTimer: {
                setTimeout(_callback, delayMs) {
                    scheduled.push(delayMs);

                    return scheduled.length;
                },
                clearTimeout() {},
            },
        });

        controller.requestCommand({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });

        expect(attempts).toBe(1);
        expect(scheduled).not.toContain(500);
    });

    it('schedules an uncertain retry from its recorded attempt rather than lifecycle completion', () => {
        let currentTime = '2026-08-05T10:00:00.000Z';
        const scheduled: number[] = [];
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch: () => ({
                            status: 'uncertain' as const,
                            reason: 'transport_ack_lost',
                        }),
                    },
                },
            ],
            emitEvent(event) {
                if (event.eventType === 'command.delivery_uncertain') {
                    currentTime = '2026-08-05T10:00:00.200Z';
                }

                return acceptedEvent();
            },
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => availableLedSnapshot,
            clock: { now: () => currentTime },
            commandTimer: {
                setTimeout(_callback, delayMs) {
                    scheduled.push(delayMs);

                    return scheduled.length;
                },
                clearTimeout() {},
            },
            enableAutomaticRetry: true,
        });

        controller.requestCommand({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });

        expect(scheduled).toContain(300);
    });

    it('does not automatically retry an uncertain volatile command', () => {
        const scheduled: number[] = [];
        let attempts = 0;
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch() {
                            attempts += 1;

                            return { status: 'uncertain' as const, reason: 'transport_ack_lost' };
                        },
                    },
                },
            ],
            emitEvent: () => acceptedEvent(),
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => ({
                ...availableLedSnapshot,
                platform: {
                    storage: {
                        ...availableLedSnapshot.platform.storage,
                        status: 'degraded' as const,
                        reason: 'storage_write_failed',
                    },
                },
            }),
            clock: { now: () => '2026-08-05T10:00:00Z' },
            commandTimer: {
                setTimeout(_callback, delayMs) {
                    scheduled.push(delayMs);

                    return scheduled.length;
                },
                clearTimeout() {},
            },
            enableAutomaticRetry: true,
        });

        controller.requestCommand({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });

        expect(attempts).toBe(1);
        expect(scheduled).not.toContain(500);
    });

    it('closes a durable outbox intent whose command is already terminal on recovery', () => {
        const mutations: unknown[] = [];
        let dispatches = 0;
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch() {
                            dispatches += 1;

                            return {
                                status: 'handed_off' as const,
                                handedOffAt: '2026-08-05T10:00:00Z',
                            };
                        },
                    },
                },
            ],
            emitEvent: () => acceptedEvent(),
            commitOutboxMutation(mutation) {
                mutations.push(mutation);
            },
            listDurableOutboxIntents: () => [
                {
                    commandId: 'cmd-terminal',
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedPower: 'on',
                    target: 'simulator-adapter',
                    state: 'ready',
                    createdAt: '2026-08-05T10:00:00Z',
                },
            ],
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => availableLedSnapshot,
            clock: { now: () => '2026-08-05T10:00:05Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout() {} },
        });

        controller.reconcileOutboxAfterRecovery();

        expect(mutations).toEqual([
            { kind: 'close', commandId: 'cmd-terminal', closedAt: '2026-08-05T10:00:05Z' },
        ]);
        expect(dispatches).toBe(0);
    });

    it('keeps a durable intent open while the same device has conflicting volatile work', () => {
        const mutations: unknown[] = [];
        const immediateTasks: Array<() => void> = [];
        const pending = pendingLedSnapshot.activeCommands[0];

        if (!pending || pending.status !== 'pending') {
            throw new Error('Expected a pending command fixture.');
        }

        const snapshot: RoomSnapshotProjection = {
            ...pendingLedSnapshot,
            activeCommands: [
                {
                    ...pending,
                    commandId: 'cmd-volatile-conflict',
                    durability: 'volatile',
                    lifecycleDurability: 'volatile',
                },
            ],
        };
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch: () => ({
                            status: 'handed_off' as const,
                            handedOffAt: '2026-08-05T10:00:01Z',
                        }),
                    },
                },
            ],
            emitEvent: () => acceptedEvent(),
            commitOutboxMutation(mutation) {
                mutations.push(mutation);
            },
            listDurableOutboxIntents: () => [
                {
                    commandId: 'cmd-durable-paused',
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedPower: 'on',
                    target: 'simulator-adapter',
                    state: 'ready',
                    createdAt: '2026-08-05T10:00:00Z',
                },
            ],
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => snapshot,
            scheduleImmediate(callback) {
                immediateTasks.push(callback);
            },
            clock: { now: () => '2026-08-05T10:00:01Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout() {} },
            enableAutomaticRetry: true,
        });

        controller.reconcileOutboxAfterRecovery();

        expect(mutations).toEqual([]);
        expect(immediateTasks).toEqual([]);
    });

    it('does not redispatch a delivered intent during recovery reconciliation', () => {
        let snapshot = availableLedSnapshot;
        const immediateTasks: Array<() => void> = [];
        let dispatches = 0;
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch() {
                            dispatches += 1;

                            return {
                                status: 'handed_off' as const,
                                handedOffAt: '2026-08-05T10:00:00Z',
                            };
                        },
                    },
                },
            ],
            emitEvent: () => acceptedEvent(),
            listDurableOutboxIntents: () => [
                {
                    commandId: 'cmd-led-pending',
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedPower: 'on',
                    target: 'simulator-adapter',
                    state: 'delivered',
                    createdAt: '2026-08-05T10:00:00Z',
                    handedOffAt: '2026-08-05T10:00:00Z',
                    deadlineAt: '2026-08-05T10:00:05Z',
                },
            ],
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => snapshot,
            scheduleImmediate(callback) {
                immediateTasks.push(callback);
            },
            clock: { now: () => '2026-08-05T10:00:01Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout() {} },
            generateCommandId: () => 'cmd-led-pending',
        });

        controller.requestCommand({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });
        immediateTasks.length = 0;
        snapshot = pendingLedSnapshot;

        controller.reconcileOutboxAfterRecovery();

        expect(immediateTasks).toEqual([]);
        expect(dispatches).toBe(0);
    });

    it('makes one immediate uncertain retry after recovery before resuming its cadence', () => {
        const immediateTasks: Array<() => void> = [];
        const scheduled: Array<{ delayMs: number; callback: () => void }> = [];
        let dispatches = 0;
        const pending = pendingLedSnapshot.activeCommands[0];

        if (!pending || pending.status !== 'pending') {
            throw new Error('Expected a pending command fixture.');
        }

        const snapshot: RoomSnapshotProjection = {
            ...pendingLedSnapshot,
            activeCommands: [
                {
                    ...pending,
                    delivery: {
                        status: 'uncertain',
                        firstAttemptedAt: '2026-08-05T10:00:00Z',
                        deadlineAt: '2026-08-05T10:00:05Z',
                    },
                },
            ],
        };
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch() {
                            dispatches += 1;

                            return {
                                status: 'handed_off' as const,
                                handedOffAt: '2026-08-05T10:00:00.500Z',
                            };
                        },
                    },
                },
            ],
            emitEvent: () => acceptedEvent(),
            listDurableOutboxIntents: () => [
                {
                    commandId: 'cmd-led-pending',
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedPower: 'on',
                    target: 'simulator-adapter',
                    state: 'uncertain',
                    createdAt: '2026-08-05T10:00:00Z',
                    attemptedAt: '2026-08-05T10:00:00Z',
                    firstAttemptedAt: '2026-08-05T10:00:00Z',
                    deadlineAt: '2026-08-05T10:00:05Z',
                    nextAttemptAt: '2026-08-05T10:00:00.500Z',
                },
            ],
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => snapshot,
            scheduleImmediate(callback) {
                immediateTasks.push(callback);
            },
            clock: { now: () => '2026-08-05T10:00:00.250Z' },
            commandTimer: {
                setTimeout(callback, delayMs) {
                    scheduled.push({ callback, delayMs });

                    return scheduled.length;
                },
                clearTimeout() {},
            },
            enableAutomaticRetry: true,
        });

        controller.reconcileOutboxAfterRecovery();

        expect(dispatches).toBe(0);
        expect(immediateTasks).toHaveLength(1);
        expect(scheduled).toEqual(
            expect.arrayContaining([expect.objectContaining({ delayMs: 4_750 })]),
        );
        immediateTasks[0]?.();

        expect(dispatches).toBe(1);
    });

    it('does not retry a ready intent whose volatile pending handoff followed a rollback', () => {
        const immediateTasks: Array<() => void> = [];
        let dispatches = 0;
        const pending = pendingLedSnapshot.activeCommands[0];

        if (!pending || pending.status !== 'pending') {
            throw new Error('Expected a pending command fixture.');
        }

        const snapshot: RoomSnapshotProjection = {
            ...pendingLedSnapshot,
            activeCommands: [{ ...pending, lifecycleDurability: 'volatile' }],
        };
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch() {
                            dispatches += 1;

                            return {
                                status: 'handed_off' as const,
                                handedOffAt: '2026-08-05T10:00:01Z',
                            };
                        },
                    },
                },
            ],
            emitEvent: () => acceptedEvent(),
            listDurableOutboxIntents: () => [
                {
                    commandId: 'cmd-led-pending',
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedPower: 'on',
                    target: 'simulator-adapter',
                    state: 'ready',
                    createdAt: '2026-08-05T10:00:00Z',
                },
            ],
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => snapshot,
            scheduleImmediate(callback) {
                immediateTasks.push(callback);
            },
            clock: { now: () => '2026-08-05T10:00:01Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout() {} },
        });

        controller.reconcileOutboxAfterRecovery();

        expect(immediateTasks).toEqual([]);
        expect(dispatches).toBe(0);
    });

    it('retains the original deadline when an enabled rollback retry is uncertain', () => {
        const mutations: unknown[] = [];
        const pending = pendingLedSnapshot.activeCommands[0];

        if (!pending || pending.status !== 'pending') {
            throw new Error('Expected a pending command fixture.');
        }

        const snapshot: RoomSnapshotProjection = {
            ...pendingLedSnapshot,
            activeCommands: [{ ...pending, lifecycleDurability: 'volatile' }],
        };
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch: () => ({
                            status: 'uncertain' as const,
                            reason: 'transport_ack_lost',
                        }),
                    },
                },
            ],
            emitEvent: () => acceptedEvent(),
            commitOutboxMutation(mutation) {
                mutations.push(mutation);
            },
            listDurableOutboxIntents: () => [
                {
                    commandId: 'cmd-led-pending',
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedPower: 'on',
                    target: 'simulator-adapter',
                    state: 'ready',
                    createdAt: '2026-08-05T10:00:00Z',
                },
            ],
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => snapshot,
            clock: { now: () => '2026-08-05T10:00:01Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout() {} },
            enableAutomaticRetry: true,
        });

        controller.reconcileOutboxAfterRecovery();

        expect(mutations).toEqual([
            expect.objectContaining({
                kind: 'upsert',
                intent: expect.objectContaining({
                    state: 'uncertain',
                    firstAttemptedAt: '2026-08-05T10:00:00Z',
                    deadlineAt: '2026-08-05T10:00:05Z',
                }),
            }),
        ]);
    });

    it('pauses durable dispatch in degraded and recovering states, then resumes active work', () => {
        const immediateTasks: Array<() => void> = [];
        let snapshot = availableLedSnapshot;
        let dispatches = 0;
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch() {
                            dispatches += 1;

                            return {
                                status: 'handed_off' as const,
                                handedOffAt: '2026-08-05T10:00:00Z',
                            };
                        },
                    },
                },
            ],
            emitEvent: () => acceptedEvent(),
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => snapshot,
            scheduleImmediate(callback) {
                immediateTasks.push(callback);
            },
            clock: { now: () => '2026-08-05T10:00:00Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout() {} },
        });

        controller.requestCommand({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });
        const dispatch = immediateTasks[0];

        expect(dispatch).toBeDefined();
        snapshot = withStorageStatus('degraded');
        dispatch?.();
        snapshot = withStorageStatus('recovering');
        dispatch?.();

        expect(dispatches).toBe(0);

        snapshot = availableLedSnapshot;
        dispatch?.();

        expect(dispatches).toBe(1);
    });

    it('continues expired-command timeout processing while durable dispatch is paused', () => {
        const events: PlatformEvent[] = [];
        const controller = createSetPowerCommandController({
            routes: [],
            emitEvent(event) {
                events.push(event);

                return acceptedEvent();
            },
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => ({
                ...pendingLedSnapshot,
                platform: {
                    storage: {
                        status: 'degraded' as const,
                        changedAt: '2026-08-05T10:00:05Z',
                        reason: 'storage_write_failed',
                        historyGenerationId: 'generation-test',
                        storedThroughSequence: 0,
                    },
                },
            }),
            clock: { now: () => '2026-08-05T10:00:05Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout() {} },
        });

        controller.reschedulePendingCommands();

        expect(events).toEqual([
            expect.objectContaining({
                eventType: 'command.timed_out',
                commandId: 'cmd-led-pending',
            }),
        ]);
    });

    it('never retries a definite no-handoff outcome even when retry capability is enabled', () => {
        const events: PlatformEvent[] = [];
        const scheduled: number[] = [];
        let attempts = 0;
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch() {
                            attempts += 1;

                            return {
                                status: 'not_handed_off' as const,
                                reason: 'adapter_unavailable',
                                message: 'The adapter did not accept the command.',
                            };
                        },
                    },
                },
            ],
            emitEvent(event) {
                events.push(event);

                return acceptedEvent();
            },
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => availableLedSnapshot,
            clock: { now: () => '2026-08-05T10:00:00Z' },
            commandTimer: {
                setTimeout(_callback, delayMs) {
                    scheduled.push(delayMs);

                    return scheduled.length;
                },
                clearTimeout() {},
            },
            enableAutomaticRetry: true,
        });

        controller.requestCommand({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });

        expect(attempts).toBe(1);
        expect(events.map((event) => event.eventType)).toEqual([
            'command.requested',
            'command.failed',
        ]);
        expect(scheduled).not.toContain(500);
    });

    it('flushes synchronous adapter reports only after each tri-state lifecycle fact', () => {
        const outcomes = [
            {
                result: {
                    status: 'handed_off' as const,
                    handedOffAt: '2026-08-05T10:00:00Z',
                },
                lifecycle: 'command.dispatched',
            },
            {
                result: {
                    status: 'not_handed_off' as const,
                    reason: 'adapter_unavailable',
                    message: 'The adapter did not accept the command.',
                },
                lifecycle: 'command.failed',
            },
            {
                result: { status: 'uncertain' as const, reason: 'transport_ack_lost' },
                lifecycle: 'command.delivery_uncertain',
            },
        ] as const;

        for (const { result, lifecycle } of outcomes) {
            const events: PlatformEvent[] = [];
            const flushedAfter: Array<PlatformEvent['eventType'] | undefined> = [];
            const controller = createSetPowerCommandController({
                routes: [
                    {
                        deviceId: 'led-main',
                        target: 'simulator-adapter',
                        dispatcher: { dispatch: () => result },
                    },
                ],
                emitEvent(event) {
                    events.push(event);

                    return acceptedEvent();
                },
                createDispatchScope() {
                    return {
                        run<T>(operation: () => T): T {
                            return operation();
                        },
                        flush() {
                            flushedAfter.push(events.at(-1)?.eventType);
                        },
                    };
                },
                getRoomSnapshot: () => availableLedSnapshot,
                clock: { now: () => '2026-08-05T10:00:00Z' },
                commandTimer: { setTimeout: () => 1, clearTimeout() {} },
            });

            controller.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });

            expect(flushedAfter).toEqual([lifecycle]);
        }
    });

    it('rejects duplicate routes when the controller is configured', () => {
        const route = {
            deviceId: 'led-main',
            target: 'simulator-adapter' as const,
            dispatcher: {
                dispatch: () => ({
                    status: 'not_handed_off' as const,
                    reason: 'test',
                    message: 'test',
                }),
            },
        };

        expect(() =>
            createSetPowerCommandController({
                routes: [route, route],
                emitEvent: () => acceptedEvent(),
                createDispatchScope: immediateDispatchScope,
                getRoomSnapshot: () => availableLedSnapshot,
                clock: { now: () => '2026-08-05T10:00:00Z' },
                commandTimer: { setTimeout: () => 1, clearTimeout: () => undefined },
            }),
        ).toThrow('Duplicate set.power command route for led-main.');
    });

    it('does not dispatch when the requested lifecycle event is rejected', () => {
        const dispatchedCommands: unknown[] = [];
        const controller = createSetPowerCommandController({
            routes: [
                {
                    deviceId: 'led-main',
                    target: 'simulator-adapter',
                    dispatcher: {
                        dispatch(command) {
                            dispatchedCommands.push(command);

                            return {
                                status: 'handed_off' as const,
                                handedOffAt: '2026-08-05T10:00:00Z',
                            };
                        },
                    },
                },
            ],
            emitEvent: () => ({
                status: 'ignored',
                reason: 'invalid_lifecycle_transition',
                state: availableLedSnapshot,
            }),
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => availableLedSnapshot,
            clock: { now: () => '2026-08-05T10:00:00Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout: () => undefined },
            generateCommandId: () => 'cmd-led-1',
        });

        expect(
            controller.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        ).toEqual({
            commandId: 'cmd-led-1',
            status: 'rejected',
            reason: 'command_lifecycle_rejected',
            message: 'The command could not be accepted by the room state.',
            durability: 'durable',
            lifecycleDurability: 'durable',
        });
        expect(dispatchedCommands).toEqual([]);
    });

    it('times out a restored command synchronously when its deadline has passed', () => {
        const events: PlatformEvent[] = [];
        let scheduledTimeouts = 0;
        const controller = createSetPowerCommandController({
            routes: [],
            emitEvent(event) {
                events.push(event);

                return acceptedEvent();
            },
            createDispatchScope: immediateDispatchScope,
            getRoomSnapshot: () => pendingLedSnapshot,
            clock: { now: () => '2026-08-05T10:00:05Z' },
            commandTimer: {
                setTimeout() {
                    scheduledTimeouts += 1;

                    return 1;
                },
                clearTimeout() {},
            },
            generateEventId: () => 'evt-timeout-1',
        });

        controller.reschedulePendingCommands();

        expect(events).toEqual([
            expect.objectContaining({
                eventType: 'command.timed_out',
                commandId: 'cmd-led-pending',
            }),
        ]);
        expect(scheduledTimeouts).toBe(0);
    });
});

const availableLedSnapshot: RoomSnapshotProjection = {
    roomName: 'Smart Room',
    updatedAt: '2026-08-05T10:00:00Z',
    devices: [
        {
            deviceId: 'led-main',
            name: 'Main LED',
            role: 'led-output',
            availability: 'online',
            availabilityChangedAt: '2026-08-05T10:00:00Z',
            availabilityDurability: 'durable',
            health: 'healthy',
            healthChangedAt: '2026-08-05T10:00:00Z',
            healthDurability: 'durable',
            reportedState: { power: 'off' },
            observationStatus: { power: { freshness: 'unknown', durability: 'durable' } },
            commandAvailability: { policy: 'allow' },
        },
    ],
    activeCommands: [],
    recentCommands: [],
    platform: {
        storage: {
            status: 'available',
            changedAt: '2026-08-05T10:00:00Z',
            historyGenerationId: 'generation-test',
            storedThroughSequence: 0,
        },
    },
};

function availableLedSnapshotFor(deviceId: string): RoomSnapshotProjection {
    return {
        ...availableLedSnapshot,
        devices: availableLedSnapshot.devices.map((device) => ({ ...device, deviceId })),
    };
}

function withStorageStatus(status: 'degraded' | 'recovering'): RoomSnapshotProjection {
    return {
        ...availableLedSnapshot,
        platform: {
            storage:
                status === 'degraded'
                    ? {
                          status,
                          changedAt: '2026-08-05T10:00:00Z',
                          reason: 'storage_write_failed',
                          historyGenerationId: 'generation-test',
                          storedThroughSequence: 0,
                      }
                    : {
                          status,
                          changedAt: '2026-08-05T10:00:00Z',
                          reason: 'storage_recovering',
                          historyGenerationId: 'generation-test',
                          storedThroughSequence: 0,
                      },
        },
    };
}

const pendingLedSnapshot: RoomSnapshotProjection = {
    ...availableLedSnapshot,
    devices: availableLedSnapshot.devices.map((device) => ({
        ...device,
        activeCommandId: 'cmd-led-pending',
    })),
    activeCommands: [
        {
            commandId: 'cmd-led-pending',
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
            requestedAt: '2026-08-05T10:00:00Z',
            durability: 'durable',
            lifecycleDurability: 'durable',
            status: 'pending',
            delivery: {
                status: 'handed_off',
                dispatchedAt: '2026-08-05T10:00:00Z',
                deadlineAt: '2026-08-05T10:00:05Z',
            },
        },
    ],
};

function createEventIdGenerator(): () => string {
    let index = 0;

    return () => `evt-command-${++index}`;
}

function acceptedEvent(): Extract<EventProcessingResult, { status: 'accepted' }> {
    return {
        status: 'accepted',
        evaluatedAt: '2026-08-05T10:00:00Z',
        state: availableLedSnapshot,
    };
}

function immediateDispatchScope() {
    return {
        run<T>(operation: () => T): T {
            return operation();
        },
        flush() {},
    };
}
