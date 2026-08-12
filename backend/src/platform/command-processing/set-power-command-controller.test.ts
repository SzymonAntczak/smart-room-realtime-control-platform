import type { PlatformEvent } from '@smart-room/contracts/events';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { describe, expect, it } from 'vitest';

import { createSetPowerCommandController } from './set-power-command-controller';

describe('createSetPowerCommandController', () => {
    it('records a synchronous dispatch failure as a terminal lifecycle fact while accepting the request', () => {
        const events: PlatformEvent[] = [];
        const controller = createSetPowerCommandController({
            dispatchCommand: {
                dispatch() {
                    throw new Error('transport unavailable');
                },
            },
            emitEvent(event) {
                events.push(event);
            },
            getRoomSnapshot: () => availableLedSnapshot,
            clock: { now: () => '2026-08-05T10:00:00Z' },
            commandTimer: { setTimeout: () => 1, clearTimeout: () => undefined },
            dispatchTarget: 'simulator-adapter',
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
            'command.dispatched',
            'command.failed',
        ]);
        expect(events.at(-1)).toMatchObject({
            commandId: 'cmd-led-1',
            payload: { reason: 'dispatch_failed' },
        });
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
            health: 'healthy',
            healthChangedAt: '2026-08-05T10:00:00Z',
            reportedState: { power: 'off' },
            observationStatus: { power: { freshness: 'unknown' } },
            commandAvailability: { policy: 'allow' },
        },
    ],
    activeCommands: [],
    recentCommands: [],
};

function createEventIdGenerator(): () => string {
    let index = 0;

    return () => `evt-command-${++index}`;
}
