import { Value } from '@sinclair/typebox/value';
import {
    type TelemetryReadingRecordedEvent,
    telemetryReadingRecordedEventSchema,
} from '@smart-room/contracts/events';
import { describe, expect, it, vi } from 'vitest';

import { createRoomEngine, type IntervalScheduler, type RoomSourceLifecycle } from './room-engine';

const at = '2026-10-12T10:00:00.000Z';
const device = {
    deviceId: 'temperature-custom',
    name: 'Custom temperature',
    role: 'temperature-sensor',
    expectedIntervalMsByCapability: { temperature: 10_000 },
} as const;

describe('createRoomEngine', () => {
    it('starts injected sources in order once and stops emissions before disconnecting them', () => {
        const lifecycle: string[] = [];
        const handle = {};
        const timer: IntervalScheduler = {
            setInterval: (_callback, intervalMs) => {
                lifecycle.push(`schedule:${intervalMs}`);

                return handle;
            },
            clearInterval: (timerHandle) => {
                expect(timerHandle).toBe(handle);
                lifecycle.push('clear-timer');
            },
        };
        const sources: RoomSourceLifecycle = {
            startCommandSources: () => lifecycle.push('commands'),
            startObservationSources: () => lifecycle.push('observations'),
            startPeriodicSources: () => lifecycle.push('periodic'),
            stopPeriodicSources: () => lifecycle.push('stop-periodic'),
            stop: () => lifecycle.push('disconnect'),
        };
        const engine = createRoomEngine({
            devices: [device],
            routes: [],
            sources,
            timer,
            clock: { now: () => at },
        });

        expect(engine.isStarted()).toBe(false);
        expect(engine.getRoomSnapshot().devices.map(({ deviceId }) => deviceId)).toEqual([
            device.deviceId,
        ]);
        engine.start();
        engine.start();

        expect(engine.isStarted()).toBe(true);
        expect(lifecycle).toEqual(['commands', 'observations', 'schedule:1000', 'periodic']);

        engine.stop();

        expect(engine.isStarted()).toBe(false);
        expect(lifecycle).toEqual([
            'commands',
            'observations',
            'schedule:1000',
            'periodic',
            'stop-periodic',
            'clear-timer',
            'disconnect',
        ]);
    });

    it('finishes snapshot and batch publication before processing reentrant source input', () => {
        const engine = createRoomEngine({
            devices: [device],
            routes: [],
            clock: { now: () => at },
            timer: { setInterval: () => ({}), clearInterval: vi.fn() },
            sources: {
                startCommandSources: vi.fn(),
                startObservationSources: vi.fn(),
                startPeriodicSources: vi.fn(),
                stopPeriodicSources: vi.fn(),
                stop: vi.fn(),
            },
        });
        const publicationOrder: string[] = [];
        let valueAfterReentrantInput: unknown;
        engine.subscribeRoomSnapshot((snapshot) => {
            const value = snapshot.devices[0]?.reportedState.temperature;
            publicationOrder.push(`snapshot:${value}`);

            if (value === 21) {
                engine.receiveSourceEvent(reading('second', 22, '2026-10-12T10:00:01.000Z'));
                valueAfterReentrantInput =
                    engine.getRoomSnapshot().devices[0]?.reportedState.temperature;
            }
        });
        engine.subscribeRoomPublicationBatch(({ snapshot }) => {
            publicationOrder.push(`batch:${snapshot.devices[0]?.reportedState.temperature}`);
        });

        try {
            engine.start();
            engine.receiveSourceEvent(reading('first', 21, at));

            expect(publicationOrder).toEqual([
                'snapshot:21',
                'batch:21',
                'snapshot:22',
                'batch:22',
            ]);
            expect(valueAfterReentrantInput).toBe(21);
            expect(engine.getRoomSnapshot().devices[0]?.reportedState.temperature).toBe(22);
        } finally {
            engine.stop();
        }
    });
});

function reading(
    eventId: string,
    value: number,
    occurredAt: string,
): TelemetryReadingRecordedEvent {
    const event: TelemetryReadingRecordedEvent = {
        eventId,
        eventType: 'telemetry.reading.recorded',
        occurredAt,
        source: 'hardware-adapter',
        deviceId: device.deviceId,
        payload: { metric: 'temperature', value, unit: 'celsius' },
    };
    expect(Value.Check(telemetryReadingRecordedEventSchema, event)).toBe(true);

    return event;
}
