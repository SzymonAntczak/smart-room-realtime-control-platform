import { describe, expect, it } from 'vitest';

import { createRoomProjector } from './room-projection';

const device = {
    deviceId: 'temp-desk',
    name: 'Desk Temperature',
    role: 'temperature-sensor',
} as const;
const at = '2026-06-08T09:30:00Z';

function projector() {
    return createRoomProjector({ devices: [device], initialUpdatedAt: '2026-06-08T09:29:59Z' });
}

function telemetry(occurredAt = at) {
    return {
        eventId: `evt-${occurredAt}`,
        eventType: 'telemetry.reading.recorded' as const,
        occurredAt,
        source: 'simulator-adapter' as const,
        deviceId: device.deviceId,
        payload: { metric: 'temperature' as const, value: 22.5, unit: 'celsius' as const },
    };
}

function availability(availability: 'online' | 'offline', occurredAt = at) {
    return {
        eventId: `availability-${occurredAt}`,
        eventType: 'device.availability.changed' as const,
        occurredAt,
        source: 'simulator-adapter' as const,
        deviceId: device.deviceId,
        payload: {
            previousAvailability: 'unknown' as const,
            availability,
            reason: availability === 'online' ? 'simulator_started' : 'device_disconnected',
        },
    };
}

describe('createRoomProjector', () => {
    it('bootstraps configured devices as unknown', () => {
        const projection = projector().getProjection();
        expect(projection.devices[0]).toMatchObject({
            availability: 'unknown',
            health: 'unknown',
            observationStatus: { temperature: { freshness: 'unknown' } },
            commandAvailability: { reason: 'read_only_device' },
        });
    });
    it('accepts first availability and health evidence at the bootstrap timestamp', () => {
        const room = createRoomProjector({ devices: [device], initialUpdatedAt: at });

        room.applyDeviceAvailabilityChanged(availability('online', at));
        room.applyDeviceHealthChanged({
            eventId: 'health-bootstrap',
            eventType: 'device.health.changed',
            occurredAt: at,
            source: 'simulator-adapter',
            deviceId: device.deviceId,
            payload: { previousHealth: 'unknown', health: 'healthy', reason: 'started' },
        });

        expect(room.getProjection().devices[0]).toMatchObject({
            availability: 'online',
            health: 'healthy',
        });
    });
    it('preserves explicit unknown evidence when installing a derived projection', () => {
        const room = createRoomProjector({ devices: [device], initialUpdatedAt: at });

        room.applyDeviceAvailabilityChanged({
            eventId: 'availability-explicit-unknown',
            eventType: 'device.availability.changed',
            occurredAt: at,
            source: 'simulator-adapter',
            deviceId: device.deviceId,
            payload: {
                previousAvailability: 'unknown',
                availability: 'unknown',
                reason: 'transport_not_ready',
            },
        });
        const derived = room.getProjection({ evaluatedAt: '2026-06-08T09:30:03Z' });
        const evidence = room.getEvidence();

        room.installProjection(derived, '2026-06-08T09:30:03Z', evidence);

        expect(room.hasAvailabilityEvidence(device.deviceId)).toBe(true);
    });
    it('does not apply first availability or health evidence older than the bootstrap timestamp', () => {
        const room = createRoomProjector({ devices: [device], initialUpdatedAt: at });
        const olderAt = '2026-06-08T09:29:59Z';

        room.applyDeviceAvailabilityChanged(availability('online', olderAt));
        room.applyDeviceHealthChanged({
            eventId: 'health-older',
            eventType: 'device.health.changed',
            occurredAt: olderAt,
            source: 'simulator-adapter',
            deviceId: device.deviceId,
            payload: { previousHealth: 'unknown', health: 'healthy', reason: 'started' },
        });

        expect(room.getProjection().devices[0]).toMatchObject({
            availability: 'unknown',
            health: 'unknown',
        });
    });
    it('changes freshness without inferring availability from telemetry age', () => {
        const room = projector();
        room.applyDeviceAvailabilityChanged(availability('online'));
        room.applyTelemetryReadingRecorded(telemetry());
        const projection = room.getProjection({ evaluatedAt: '2026-06-08T09:30:03Z' });
        expect(projection.devices[0]).toMatchObject({
            availability: 'online',
            health: 'unknown',
            observationStatus: { temperature: { freshness: 'stale', lastObservedAt: at } },
        });
    });
    it('keeps an installed derived freshness evaluation when a later projection is forked', () => {
        const room = projector();
        room.applyTelemetryReadingRecorded(telemetry());
        const staleAt = '2026-06-08T09:30:02.501Z';
        const derived = room.getProjection({ evaluatedAt: staleAt });

        room.installProjection(derived, staleAt);

        expect(room.fork().getProjection().devices[0]?.observationStatus.temperature).toMatchObject(
            {
                freshness: 'stale',
                lastObservedAt: at,
            },
        );
    });
    it('retains an explicit offline availability change with the last observation', () => {
        const room = projector();
        room.applyTelemetryReadingRecorded(telemetry());
        room.applyDeviceAvailabilityChanged(availability('offline', '2026-06-08T09:30:01Z'));
        expect(room.getProjection().devices[0]).toMatchObject({
            availability: 'offline',
            availabilityReason: 'device_disconnected',
            reportedState: { temperature: 22.5 },
        });
    });
    it('does not regress delayed availability evidence', () => {
        const room = projector();
        room.applyDeviceAvailabilityChanged(availability('offline', '2026-06-08T09:30:02Z'));
        room.applyDeviceAvailabilityChanged(availability('online', at));
        expect(room.getProjection().devices[0]?.availability).toBe('offline');
    });
    it('does not apply an equal-timestamp health transition and clears a recovered reason', () => {
        const room = projector();
        room.applyDeviceHealthChanged({
            eventId: 'health-1',
            eventType: 'device.health.changed',
            occurredAt: at,
            source: 'simulator-adapter',
            deviceId: device.deviceId,
            payload: { previousHealth: 'unknown', health: 'degraded', reason: 'partial_data' },
        });
        room.applyDeviceHealthChanged({
            eventId: 'health-equal',
            eventType: 'device.health.changed',
            occurredAt: at,
            source: 'simulator-adapter',
            deviceId: device.deviceId,
            payload: { previousHealth: 'degraded', health: 'healthy', reason: 'recovered' },
        });
        expect(room.getProjection().devices[0]).toMatchObject({
            health: 'degraded',
            healthReason: 'partial_data',
        });
        room.applyDeviceHealthChanged({
            eventId: 'health-recovered',
            eventType: 'device.health.changed',
            occurredAt: '2026-06-08T09:30:01Z',
            source: 'simulator-adapter',
            deviceId: device.deviceId,
            payload: { previousHealth: 'degraded', health: 'healthy', reason: 'recovered' },
        });
        expect(room.getProjection().devices[0]).toMatchObject({ health: 'healthy' });
        expect(room.getProjection().devices[0]?.healthReason).toBeUndefined();
    });
    it('keeps health independent from availability', () => {
        const room = projector();
        room.applyDeviceAvailabilityChanged(availability('online'));
        room.applyDeviceHealthChanged({
            eventId: 'health-1',
            eventType: 'device.health.changed',
            occurredAt: '2026-06-08T09:30:01Z',
            source: 'simulator-adapter',
            deviceId: device.deviceId,
            payload: { previousHealth: 'unknown', health: 'degraded', reason: 'partial_data' },
        });
        expect(room.getProjection().devices[0]).toMatchObject({
            availability: 'online',
            health: 'degraded',
            healthReason: 'partial_data',
        });
    });
});
