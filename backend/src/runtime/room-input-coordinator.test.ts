import type { PlatformEvent } from '@smart-room/contracts/events';
import { describe, expect, it } from 'vitest';

import { createRoomInputCoordinator, type RoomInputCoordinator } from './room-input-coordinator';

describe('createRoomInputCoordinator', () => {
    it('captures ingress before reentrant queueing and drains events and timers in FIFO order', () => {
        const timestamps = ['2026-08-31T09:00:00Z', '2026-08-31T09:00:01Z', '2026-08-31T09:00:02Z'];
        const dispatched: Array<{
            kind: 'event' | 'timer';
            eventId?: string;
            receivedAt: string;
            ingestSequence: number;
        }> = [];
        const coordinator: RoomInputCoordinator<string> = createRoomInputCoordinator({
            now() {
                const timestamp = timestamps.shift();

                if (!timestamp) {
                    throw new Error('Unexpected ingress timestamp request.');
                }

                return timestamp;
            },
            dispatch(input) {
                dispatched.push({ kind: 'event', eventId: input.event.eventId, ...input.ingress });

                if (input.event.eventId === 'event-1') {
                    expect(coordinator.receive(event('event-2'))).toBeUndefined();
                    coordinator.receiveTimer((ingress) => {
                        dispatched.push({ kind: 'timer', ...ingress });
                    });
                }

                return input.event.eventId;
            },
        });

        expect(coordinator.receive(event('event-1'))).toBe('event-1');
        expect(dispatched).toEqual([
            {
                kind: 'event',
                eventId: 'event-1',
                receivedAt: '2026-08-31T09:00:00Z',
                ingestSequence: 1,
            },
            {
                kind: 'event',
                eventId: 'event-2',
                receivedAt: '2026-08-31T09:00:01Z',
                ingestSequence: 2,
            },
            {
                kind: 'timer',
                receivedAt: '2026-08-31T09:00:02Z',
                ingestSequence: 3,
            },
        ]);
    });

    it('preserves a previously captured adapter receivedAt while delaying its dispatch', () => {
        const dispatched: Array<{ receivedAt: string; ingestSequence: number }> = [];
        const coordinator = createRoomInputCoordinator({
            now: () => '2026-08-31T09:00:10Z',
            dispatch(input) {
                dispatched.push(input.ingress);

                return input.event.eventId;
            },
        });

        coordinator.receiveAt(event('buffered-report'), '2026-08-31T09:00:04.999Z');

        expect(dispatched).toEqual([{ receivedAt: '2026-08-31T09:00:04.999Z', ingestSequence: 1 }]);
    });
});

function event(eventId: string): PlatformEvent {
    return {
        eventId,
        eventType: 'telemetry.reading.recorded',
        occurredAt: '2026-08-31T09:00:00Z',
        source: 'simulator-adapter',
        deviceId: 'temp-desk',
        payload: { metric: 'temperature', value: 22, unit: 'celsius' },
    };
}
