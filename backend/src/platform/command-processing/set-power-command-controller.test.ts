import type { PlatformEvent } from '@smart-room/contracts/events';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { describe, expect, it } from 'vitest';

import type { EventProcessingResult } from '../event-processing/event-processor';

import { createSetPowerCommandController } from './set-power-command-controller';

describe('createSetPowerCommandController', () => {
    it('records a synchronous dispatch failure as a terminal lifecycle fact while accepting the request', () => {
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

        expect(
            controller.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        ).toEqual({ commandId: 'cmd-led-1', status: 'accepted' });
        expect(events.map((event) => event.eventType)).toEqual([
            'command.requested',
            'command.failed',
        ]);
        expect(events.at(-1)).toMatchObject({
            commandId: 'cmd-led-1',
            payload: { reason: 'dispatch_failed' },
        });
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
        ).toEqual({ commandId: 'cmd-led-reading-1', status: 'accepted' });
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
        });
        expect(events).toEqual([]);
    });

    it('rejects duplicate routes when the controller is configured', () => {
        const route = {
            deviceId: 'led-main',
            target: 'simulator-adapter' as const,
            dispatcher: { dispatch: () => undefined },
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
                    dispatcher: { dispatch: (command) => dispatchedCommands.push(command) },
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
            dispatchedAt: '2026-08-05T10:00:00Z',
            deadlineAt: '2026-08-05T10:00:05Z',
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
