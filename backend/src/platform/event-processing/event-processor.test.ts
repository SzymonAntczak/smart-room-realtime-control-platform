import { describe, expect, it } from 'vitest';

import { createRoomProjector } from '../read-model/room-projection';

import { createEventProcessor } from './event-processor';

function processor() {
    return createEventProcessor({
        devices: [{ deviceId: 'temp-desk', name: 'Desk Temperature', role: 'temperature-sensor' }],
        roomProjector: createRoomProjector({
            devices: [
                { deviceId: 'temp-desk', name: 'Desk Temperature', role: 'temperature-sensor' },
            ],
            initialUpdatedAt: '2026-06-08T09:29:59Z',
        }),
        clock: { now: () => '2026-06-08T09:30:00Z' },
    });
}

describe('createEventProcessor', () => {
    it('routes explicit availability evidence independently of telemetry', () => {
        const result = processor().processEvent({
            eventId: 'availability-1',
            eventType: 'device.availability.changed',
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: {
                previousAvailability: 'unknown',
                availability: 'online',
                reason: 'simulator_started',
            },
        });
        expect(result.status).toBe('accepted');
        expect(result.state.devices[0]).toMatchObject({
            availability: 'online',
            health: 'unknown',
        });
    });
    it('routes operational health evidence independently of availability', () => {
        const result = processor().processEvent({
            eventId: 'health-1',
            eventType: 'device.health.changed',
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { previousHealth: 'unknown', health: 'degraded', reason: 'partial_data' },
        });
        expect(result.state.devices[0]).toMatchObject({
            availability: 'unknown',
            health: 'degraded',
            healthReason: 'partial_data',
        });
    });
    it('keeps equal-timestamp transitions diagnosable instead of regressing the projection', () => {
        const room = processor();
        room.processEvent({
            eventId: 'availability-1',
            eventType: 'device.availability.changed',
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: {
                previousAvailability: 'unknown',
                availability: 'online',
                reason: 'simulator_started',
            },
        });
        const result = room.processEvent({
            eventId: 'availability-equal',
            eventType: 'device.availability.changed',
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: {
                previousAvailability: 'online',
                availability: 'offline',
                reason: 'device_disconnected',
            },
        });
        expect(result).toMatchObject({ status: 'ignored', reason: 'stale_device_transition' });
        expect(result.state.devices[0]?.availability).toBe('online');
    });
    it('does not infer availability from an accepted telemetry report', () => {
        const result = processor().processEvent({
            eventId: 'reading-1',
            eventType: 'telemetry.reading.recorded',
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { metric: 'temperature', value: 22.5, unit: 'celsius' },
        });
        expect(result.state.devices[0]).toMatchObject({
            availability: 'unknown',
            observationStatus: { temperature: { freshness: 'fresh' } },
        });
    });
    it('rejects future reports without updating observations', () => {
        const result = processor().processEvent({
            eventId: 'future-1',
            eventType: 'telemetry.reading.recorded',
            occurredAt: '2026-06-08T09:30:01.001Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { metric: 'temperature', value: 22.5, unit: 'celsius' },
        });
        expect(result).toMatchObject({ status: 'ignored', reason: 'future_dated_report' });
        expect(result.state.devices[0]?.observationStatus).toEqual({
            temperature: { freshness: 'unknown' },
        });
    });
});
