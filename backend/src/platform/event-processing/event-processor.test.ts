import type { PlatformEventEnvelope } from '@smart-room/contracts';
import { describe, expect, it } from 'vitest';

import { createRoomProjector } from '../read-model/room-projection';

import { createEventProcessor } from './event-processor';

describe('createEventProcessor', () => {
    it('derives an online read-only temperature device from a telemetry event', () => {
        const processor = createTemperatureProcessor();

        const result = processor.processEvent(createTemperatureEvent());

        expect(result.status).toBe('accepted');
        if (result.status === 'accepted') {
            expect(result.evaluatedAt).toBe('2026-06-08T09:30:00Z');
        }
        expect(result.state).toEqual({
            updatedAt: '2026-06-08T09:30:00Z',
            devices: [
                {
                    deviceId: 'temp-desk',
                    name: 'Desk Temperature',
                    role: 'temperature-sensor',
                    health: 'online',
                    reportedState: {
                        temperature: 22.5,
                        temperatureUnit: 'celsius',
                    },
                    commandAvailability: {
                        policy: 'block',
                        reason: 'read_only_device',
                    },
                    lastSeenAt: '2026-06-08T09:30:00Z',
                    recentEvents: expect.any(Array),
                },
            ],
            activeCommands: [],
            recentCommands: [],
            recentEvents: [
                {
                    eventId: 'evt-temperature-1',
                    eventType: 'telemetry.reading.recorded',
                    occurredAt: '2026-06-08T09:30:00Z',
                    source: 'simulator-adapter',
                    deviceId: 'temp-desk',
                    commandId: undefined,
                    summary: 'Temperature reading recorded',
                },
            ],
        });
    });

    it('updates the latest temperature reading and keeps recent event history', () => {
        const processor = createTemperatureProcessor();

        processor.processEvent(createTemperatureEvent());
        const result = processor.processEvent(
            createTemperatureEvent({
                eventId: 'evt-temperature-2',
                occurredAt: '2026-06-08T09:30:01Z',
                payload: {
                    metric: 'temperature',
                    value: 22.7,
                    unit: 'celsius',
                },
            }),
        );

        expect(result.status).toBe('accepted');
        expect(result.state.updatedAt).toBe('2026-06-08T09:30:01Z');
        expect(result.state.devices[0]?.reportedState).toEqual({
            temperature: 22.7,
            temperatureUnit: 'celsius',
        });
        expect(result.state.recentEvents.map((event) => event.eventId)).toEqual([
            'evt-temperature-2',
            'evt-temperature-1',
        ]);
    });

    it('ignores malformed events without updating derived state', () => {
        const processor = createTemperatureProcessor();

        const result = processor.processEvent({
            eventType: 'telemetry.reading.recorded',
            version: 1,
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: {
                metric: 'temperature',
                value: 22.5,
                unit: 'celsius',
            },
        });

        expect(result).toMatchObject({
            status: 'ignored',
            reason: 'malformed_event',
        });
        expect(result.state.devices).toEqual([]);
        expect(result.state.recentEvents).toEqual([]);
    });

    it('ignores events with invalid envelope field types', () => {
        const processor = createTemperatureProcessor();

        const result = processor.processEvent(
            createTemperatureEvent({
                occurredAt: 'not-a-date',
            }),
        );

        expect(result).toMatchObject({
            status: 'ignored',
            reason: 'malformed_event',
        });
        expect(result.state.devices).toEqual([]);
    });

    it('ignores duplicate event ids without adding duplicate history', () => {
        const processor = createTemperatureProcessor();

        processor.processEvent(createTemperatureEvent());
        const result = processor.processEvent(
            createTemperatureEvent({
                payload: {
                    metric: 'temperature',
                    value: 23,
                    unit: 'celsius',
                },
            }),
        );

        expect(result).toMatchObject({
            status: 'ignored',
            reason: 'duplicate_event',
        });
        expect(result.state.devices[0]?.reportedState).toEqual({
            temperature: 22.5,
            temperatureUnit: 'celsius',
        });
        expect(result.state.recentEvents).toHaveLength(1);
    });

    it('does not update state for unsupported event versions', () => {
        const processor = createTemperatureProcessor();

        const result = processor.processEvent(
            createTemperatureEvent({
                version: 2,
            } as unknown as Partial<PlatformEventEnvelope>),
        );

        expect(result).toMatchObject({
            status: 'ignored',
            reason: 'unsupported_event_version',
        });
        expect(result.state.devices).toEqual([]);
        expect(result.state.recentEvents).toEqual([]);
    });

    it('keeps a structurally valid unsupported event type observable', () => {
        const processor = createTemperatureProcessor();

        const result = processor.processEvent(
            createTemperatureEvent({
                eventType: 'device.unknown',
            } as unknown as Partial<PlatformEventEnvelope>),
        );

        expect(result).toMatchObject({
            status: 'ignored',
            reason: 'unsupported_event_type',
        });
    });

    it('normalizes an offset timestamp before projecting telemetry', () => {
        const processor = createTemperatureProcessor();

        const result = processor.processEvent(
            createTemperatureEvent({
                occurredAt: '2026-06-08T11:30:00+02:00',
            }),
        );

        expect(result).toMatchObject({
            status: 'accepted',
        });
        expect(result.state.updatedAt).toBe('2026-06-08T09:30:00Z');
    });

    it('accepts a report exactly at the future clock-skew tolerance', () => {
        const processor = createTemperatureProcessor({
            now: '2026-06-08T09:30:00Z',
        });

        const result = processor.processEvent(
            createTemperatureEvent({
                occurredAt: '2026-06-08T09:30:01Z',
            }),
        );

        expect(result.status).toBe('accepted');
        expect(result.state.devices[0]?.lastSeenAt).toBe('2026-06-08T09:30:01Z');
    });

    it('ignores a future-dated report without updating state or remembering its event id', () => {
        const now = { value: '2026-06-08T09:30:00Z' };
        const processor = createTemperatureProcessor({
            clock: { now: () => now.value },
        });

        const futureEvent = createTemperatureEvent({
            occurredAt: '2026-06-08T09:30:01.001Z',
        });
        const ignored = processor.processEvent(futureEvent);

        expect(ignored).toMatchObject({
            status: 'ignored',
            reason: 'future_dated_report',
        });
        expect(ignored.state.devices).toEqual([]);
        expect(ignored.state.recentEvents).toEqual([]);

        now.value = '2026-06-08T09:30:00.001Z';
        const retried = processor.processEvent(futureEvent);

        expect(retried.status).toBe('accepted');
        expect(retried.state.devices[0]?.health).toBe('online');
    });

    it('does not restore offline health from an accepted out-of-order report', () => {
        const now = { value: '2026-06-08T09:30:00Z' };
        const processor = createTemperatureProcessor({
            clock: { now: () => now.value },
        });

        processor.processEvent(createTemperatureEvent());
        now.value = '2026-06-08T09:30:10.001Z';

        const result = processor.processEvent(
            createTemperatureEvent({
                eventId: 'evt-temperature-late',
                occurredAt: '2026-06-08T09:29:59Z',
            }),
        );

        expect(result.status).toBe('accepted');
        expect(result.state.devices[0]).toEqual(
            expect.objectContaining({
                health: 'offline',
                lastSeenAt: '2026-06-08T09:30:00Z',
            }),
        );
        expect(result.state.recentEvents.map((event) => event.eventId)).toEqual([
            'evt-temperature-late',
            'evt-temperature-1',
        ]);
    });

    it('does not update state for malformed temperature payloads', () => {
        const processor = createTemperatureProcessor();

        const result = processor.processEvent(
            createTemperatureEvent({
                payload: {
                    metric: 'temperature',
                    value: Number.NaN,
                    unit: 'celsius',
                },
            }),
        );

        expect(result).toMatchObject({
            status: 'ignored',
            reason: 'invalid_payload',
        });
        expect(result.state.devices).toEqual([]);
    });

    it('does not apply a temperature reading to a non-temperature device role', () => {
        const processor = createEventProcessor({
            devices: [
                {
                    deviceId: 'led-main',
                    name: 'Main LED',
                    role: 'led-output',
                },
            ],
            roomProjector: createRoomProjector({
                initialUpdatedAt: '2026-06-08T09:29:59Z',
                devices: [
                    {
                        deviceId: 'led-main',
                        name: 'Main LED',
                        role: 'led-output',
                    },
                ],
            }),
        });

        const result = processor.processEvent(
            createTemperatureEvent({
                deviceId: 'led-main',
            }),
        );

        expect(result).toMatchObject({
            status: 'ignored',
            reason: 'device_metric_mismatch',
        });
        expect(result.state.devices).toEqual([]);
    });
});

function createTemperatureProcessor({
    clock,
    now,
}: {
    clock?: { now(): string };
    now?: string;
} = {}) {
    const devices = [
        {
            deviceId: 'temp-desk',
            name: 'Desk Temperature',
            role: 'temperature-sensor' as const,
        },
    ];

    return createEventProcessor({
        devices,
        clock: clock ?? { now: () => now ?? '2026-06-08T09:30:00Z' },
        roomProjector: createRoomProjector({
            initialUpdatedAt: '2026-06-08T09:29:59Z',
            devices,
        }),
    });
}

function createTemperatureEvent(
    overrides: Partial<PlatformEventEnvelope> = {},
): PlatformEventEnvelope {
    return {
        eventId: 'evt-temperature-1',
        eventType: 'telemetry.reading.recorded',
        version: 1,
        occurredAt: '2026-06-08T09:30:00Z',
        source: 'simulator-adapter',
        deviceId: 'temp-desk',
        payload: {
            metric: 'temperature',
            value: 22.5,
            unit: 'celsius',
        },
        ...overrides,
    };
}
