import { EventEmitter } from 'node:events';

import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type { RoomRealtimeServerMessage } from '@smart-room/contracts/realtime';
import { describe, expect, it } from 'vitest';

import { type RoomRealtimeWritable, startRoomRealtimePublisher } from './room-bff-sse';

describe('startRoomRealtimePublisher', () => {
    it('waits for drain and preserves a full 20-command lifecycle burst', () => {
        const stream = new ControlledWritable([true, true, true, false, true, true, true]);
        const room = createRoomHarness(createSnapshot());

        startRoomRealtimePublisher(stream, room.config);
        room.publish(createSnapshot({ status: 'accepted', storedThroughSequence: 1 }));
        room.publish(createSnapshot({ status: 'pending', storedThroughSequence: 2 }));
        room.publish(createSnapshot({ status: 'confirmed', storedThroughSequence: 3 }));

        expect(stream.endCount).toBe(0);
        expect(messages(stream)).toHaveLength(4);
        expect(messages(stream).map((message) => message.messageType)).toEqual([
            'room.snapshot',
            'commands.updated',
            'platform.updated',
            'commands.updated',
        ]);

        stream.emit('drain');

        expect(stream.endCount).toBe(0);
        expect(room.subscriptionCount()).toBe(1);
        expect(messages(stream).map((message) => message.messageType)).toEqual([
            'room.snapshot',
            'commands.updated',
            'platform.updated',
            'commands.updated',
            'platform.updated',
            'commands.updated',
            'platform.updated',
        ]);
        expect(revisions(messages(stream))).toEqual([
            [undefined, 0],
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 4],
            [4, 5],
            [5, 6],
        ]);
        const terminalUpdate = messages(stream).at(-2);

        expect(terminalUpdate).toMatchObject({
            messageType: 'commands.updated',
            payload: { activeCommands: [] },
        });
        expect(
            terminalUpdate?.messageType === 'commands.updated'
                ? terminalUpdate.payload.recentCommands[0]
                : undefined,
        ).toMatchObject({ commandId: 'cmd-current', status: 'confirmed' });
    });

    it('closes once when a second batch arrives before drain', () => {
        const stream = new ControlledWritable([true, false]);
        const room = createRoomHarness(createSnapshot());

        startRoomRealtimePublisher(stream, room.config);
        room.publish(createSnapshot({ status: 'accepted', storedThroughSequence: 1 }));
        room.publish(createSnapshot({ status: 'pending', storedThroughSequence: 2 }));
        room.publish(createSnapshot({ status: 'confirmed', storedThroughSequence: 3 }));
        const writesBeforeLateDrain = stream.writes.length;

        expect(stream.endCount).toBe(1);
        expect(room.subscriptionCount()).toBe(0);

        stream.emit('drain');

        expect(stream.writes).toHaveLength(writesBeforeLateDrain);
        expect(stream.endCount).toBe(1);
    });

    it('cleans up on a stream error and ignores a later drain', () => {
        const stream = new ControlledWritable([false]);
        const room = createRoomHarness(createSnapshot());

        startRoomRealtimePublisher(stream, room.config);
        const writesBeforeError = stream.writes.length;

        stream.emit('error');
        stream.emit('drain');
        room.publish(createSnapshot({ status: 'accepted', storedThroughSequence: 1 }));

        expect(stream.endCount).toBe(1);
        expect(room.subscriptionCount()).toBe(0);
        expect(stream.writes).toHaveLength(writesBeforeError);
    });
});

class ControlledWritable extends EventEmitter implements RoomRealtimeWritable {
    readonly writes: string[] = [];
    endCount = 0;
    readonly #writeResults: boolean[];

    constructor(writeResults: boolean[]) {
        super();
        this.#writeResults = [...writeResults];
    }

    get destroyed(): boolean {
        return false;
    }

    get writableEnded(): boolean {
        return this.endCount > 0;
    }

    end(): void {
        this.endCount += 1;
    }

    write(chunk: string): boolean {
        this.writes.push(chunk);

        return this.#writeResults.shift() ?? true;
    }
}

function createRoomHarness(initial: RoomSnapshotProjection) {
    let snapshot = initial;
    const listeners = new Set<(next: RoomSnapshotProjection) => void>();

    return {
        config: {
            getRoomSnapshot() {
                return snapshot;
            },
            subscribeRoomSnapshot(listener: (next: RoomSnapshotProjection) => void) {
                listeners.add(listener);

                return () => {
                    listeners.delete(listener);
                };
            },
            now() {
                return '2026-09-03T08:00:00Z';
            },
        },
        publish(next: RoomSnapshotProjection) {
            snapshot = next;

            for (const listener of listeners) {
                listener(next);
            }
        },
        subscriptionCount() {
            return listeners.size;
        },
    };
}

function createSnapshot({
    status,
    storedThroughSequence = 0,
}: {
    status?: 'accepted' | 'pending' | 'confirmed';
    storedThroughSequence?: number;
} = {}): RoomSnapshotProjection {
    const command = {
        commandId: 'cmd-current',
        deviceId: 'led-main',
        commandType: 'set.power' as const,
        requestedState: { power: 'on' as const },
        requestedAt: '2026-09-03T07:59:59Z',
        durability: 'durable' as const,
        lifecycleDurability: 'durable' as const,
    };
    const recentCommands = createRecentCommands();
    const activeCommand =
        status === 'accepted'
            ? { ...command, status: 'accepted' as const }
            : status === 'pending'
              ? {
                    ...command,
                    status: 'pending' as const,
                    delivery: {
                        status: 'handed_off' as const,
                        dispatchedAt: '2026-09-03T08:00:00Z',
                        deadlineAt: '2026-09-03T08:00:05Z',
                    },
                }
              : undefined;
    const confirmedCommand =
        status === 'confirmed'
            ? {
                  ...command,
                  status: 'confirmed' as const,
                  delivery: {
                      status: 'handed_off' as const,
                      dispatchedAt: '2026-09-03T08:00:00Z',
                      deadlineAt: '2026-09-03T08:00:05Z',
                  },
                  confirmedAt: '2026-09-03T08:00:01Z',
              }
            : undefined;

    return {
        roomName: 'Smart Room',
        updatedAt: '2026-09-03T08:00:00Z',
        devices: [
            {
                deviceId: 'led-main',
                name: 'Main LED',
                role: 'led-output',
                availability: 'online',
                availabilityChangedAt: '2026-09-03T07:59:00Z',
                availabilityDurability: 'durable',
                health: 'healthy',
                healthChangedAt: '2026-09-03T07:59:00Z',
                healthDurability: 'durable',
                reportedState: { power: status === 'confirmed' ? 'on' : 'off' },
                observationStatus: {
                    power: {
                        freshness: 'unknown',
                        lastObservedAt: '2026-09-03T07:59:00Z',
                        durability: 'durable',
                    },
                },
                commandAvailability: { policy: 'allow' },
                ...(activeCommand ? { activeCommandId: command.commandId } : {}),
            },
        ],
        activeCommands: activeCommand ? [activeCommand] : [],
        recentCommands: confirmedCommand
            ? [confirmedCommand, ...recentCommands.slice(0, 19)]
            : recentCommands,
        platform: {
            storage: {
                status: 'available',
                changedAt: '2026-09-03T07:59:00Z',
                historyGenerationId: 'generation-test',
                storedThroughSequence,
            },
        },
    };
}

function createRecentCommands(): RoomSnapshotProjection['recentCommands'] {
    return Array.from({ length: 20 }, (_, index) => ({
        commandId: `cmd-history-${index}`,
        deviceId: 'led-main',
        commandType: 'set.power' as const,
        requestedState: { power: index % 2 === 0 ? ('on' as const) : ('off' as const) },
        requestedAt: `2026-09-03T07:${String(59 - index).padStart(2, '0')}:00Z`,
        durability: 'durable' as const,
        lifecycleDurability: 'durable' as const,
        status: 'confirmed' as const,
        delivery: {
            status: 'handed_off' as const,
            dispatchedAt: `2026-09-03T07:${String(59 - index).padStart(2, '0')}:01Z`,
            deadlineAt: `2026-09-03T07:${String(59 - index).padStart(2, '0')}:06Z`,
        },
        confirmedAt: `2026-09-03T07:${String(59 - index).padStart(2, '0')}:02Z`,
    }));
}

function messages(stream: ControlledWritable): RoomRealtimeServerMessage[] {
    return stream.writes.map((frame) => {
        const data = frame
            .split('\n')
            .find((line) => line.startsWith('data: '))
            ?.slice('data: '.length);

        if (!data) {
            throw new Error('SSE frame did not contain data.');
        }

        return JSON.parse(data) as RoomRealtimeServerMessage;
    });
}

function revisions(
    realtimeMessages: readonly RoomRealtimeServerMessage[],
): Array<[number | undefined, number]> {
    return realtimeMessages.map((message) => [
        message.messageType === 'room.snapshot' ? undefined : message.previousRevision,
        message.revision,
    ]);
}
