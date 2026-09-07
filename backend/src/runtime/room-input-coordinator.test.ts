import type { PlatformEvent } from '@smart-room/contracts/events';
import { describe, expect, it } from 'vitest';

import {
    createRoomInputCoordinator,
    type RecoveryCutoverToken,
    type RoomInputCoordinator,
} from './room-input-coordinator';

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

    it('aborts at the 1001st raw input and drains all 1001 entries FIFO without loss', () => {
        const dispatched: string[] = [];
        let cutover: RecoveryCutoverToken | undefined;
        const coordinator = createRoomInputCoordinator({
            now: () => '2026-08-31T09:00:10Z',
            dispatch(input) {
                dispatched.push(input.event.eventId);

                if (input.event.eventId === 'boundary') {
                    cutover = coordinator.beginRecoveryCutover();

                    for (let index = 1; index <= 1_001; index += 1) {
                        coordinator.receive(event(`queued-${index}`));
                    }
                }

                return input.event.eventId;
            },
        });

        expect(coordinator.receive(event('boundary'))).toBe('boundary');
        expect(dispatched).toEqual(['boundary']);
        expect(cutover?.queuedInputCount).toBe(1_001);
        expect(cutover?.overflowed).toBe(true);
        expect(cutover?.shouldAbort()).toBe(true);

        cutover?.abort();

        expect(dispatched).toEqual([
            'boundary',
            ...Array.from({ length: 1_001 }, (_, index) => `queued-${index + 1}`),
        ]);
    });

    it('latches overflow for inputs already queued behind the recovery timer', () => {
        const dispatched: string[] = [];
        let cutover: RecoveryCutoverToken | undefined;
        const coordinator = createRoomInputCoordinator({
            now: () => '2026-08-31T09:00:10Z',
            dispatch(input) {
                dispatched.push(input.event.eventId);

                if (input.event.eventId === 'boundary') {
                    coordinator.receiveTimer(() => {
                        cutover = coordinator.beginRecoveryCutover();
                    });

                    for (let index = 1; index <= 1_001; index += 1) {
                        coordinator.receive(event(`queued-before-token-${index}`));
                    }
                }

                return input.event.eventId;
            },
        });

        expect(coordinator.receive(event('boundary'))).toBe('boundary');
        expect(cutover?.queuedInputCount).toBe(1_001);
        expect(cutover?.overflowed).toBe(true);
        expect(cutover?.shouldAbort()).toBe(true);

        cutover?.abort();

        expect(dispatched).toEqual([
            'boundary',
            ...Array.from({ length: 1_001 }, (_, index) => `queued-before-token-${index + 1}`),
        ]);
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
