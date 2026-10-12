import { describe, expect, it } from 'vitest';

import type { AcceptedInputIdentity } from '../storage/room-storage';

import { createRoomProjector } from './room-projection';
import {
    mergeRecoveryEvidence,
    mergeRecoveryProjection,
    mergeVolatileGuards,
} from './room-recovery-policy';

describe('room recovery policy', () => {
    it.each([
        {
            volatileAt: '2026-09-10T10:00:00.000Z',
            expectedValue: 21,
            expectedAvailability: 'unknown',
            expectedEvidence: [],
        },
        {
            volatileAt: '2026-09-10T10:00:01.000Z',
            expectedValue: 22,
            expectedAvailability: 'online',
            expectedEvidence: ['temperature-custom'],
        },
    ])(
        'selects matching projection and evidence for volatile timestamp $volatileAt',
        ({ volatileAt, expectedValue, expectedAvailability, expectedEvidence }) => {
            const durableAt = '2026-09-10T10:00:00.000Z';
            const device = {
                deviceId: 'temperature-custom',
                name: 'Custom temperature',
                role: 'temperature-sensor',
            } as const;
            const durable = createRoomProjector({ devices: [device], initialUpdatedAt: durableAt });
            const volatile = createRoomProjector({
                devices: [device],
                initialUpdatedAt: durableAt,
            });

            for (const [projector, occurredAt, value] of [
                [durable, durableAt, 21],
                [volatile, volatileAt, 22],
            ] as const) {
                projector.applyTelemetryReadingRecorded({
                    eventId: `reading-${value}`,
                    eventType: 'telemetry.reading.recorded',
                    occurredAt,
                    source: 'hardware-adapter',
                    deviceId: device.deviceId,
                    payload: { metric: 'temperature', value, unit: 'celsius' },
                });
            }

            volatile.applyDeviceAvailabilityChanged({
                eventId: 'availability',
                eventType: 'device.availability.changed',
                occurredAt: volatileAt,
                source: 'hardware-adapter',
                deviceId: device.deviceId,
                payload: {
                    previousAvailability: 'unknown',
                    availability: 'online',
                    reason: 'connected',
                },
            });
            const durableProjection = durable.getProjection();
            const volatileProjection = volatile.getProjection();

            expect(
                mergeRecoveryProjection(durableProjection, volatileProjection).devices[0],
            ).toMatchObject({
                reportedState: { temperature: expectedValue },
                availability: expectedAvailability,
            });
            expect(
                mergeRecoveryEvidence(
                    durable.getEvidence(),
                    volatile.getEvidence(),
                    durableProjection,
                    volatileProjection,
                ).availabilityDeviceIds,
            ).toEqual(expectedEvidence);
            expect(durable.getProjection().devices[0]?.reportedState.temperature).toBe(21);
        },
    );

    it('keeps the oldest conflicting identity and bounds guards by retention and capacity', () => {
        const identities: AcceptedInputIdentity[] = [
            identity('event-old', '2026-09-10T09:58:00.000Z'),
            identity('event-new', '2026-09-10T09:59:00.000Z'),
            identity('event-old', '2026-09-10T09:59:30.000Z', 'different-fingerprint'),
            identity('expired', '2026-09-10T09:00:00.000Z'),
            { ...identity('durable', '2026-09-10T09:59:20.000Z'), durability: 'durable' },
        ];

        expect(
            mergeVolatileGuards([], identities, {
                asOf: '2026-09-10T10:00:00.000Z',
                retentionMs: 120_000,
                entryLimit: 1,
            }),
        ).toEqual([identity('event-new', '2026-09-10T09:59:00.000Z')]);
    });

    it('merges restored and live guards without replacing the first accepted identity', () => {
        expect(
            mergeVolatileGuards(
                [identity('event-1', '2026-09-10T09:59:00.000Z')],
                [identity('event-1', '2026-09-10T09:59:01.000Z', 'conflicting-fingerprint')],
                { asOf: '2026-09-10T10:00:00.000Z', retentionMs: 120_000, entryLimit: 10 },
            ),
        ).toEqual([identity('event-1', '2026-09-10T09:59:00.000Z')]);
    });
});

function identity(
    eventId: string,
    acceptedAt: string,
    fingerprint = `fp:v1:sha256:${eventId}`,
): AcceptedInputIdentity {
    return { eventId, acceptedAt, fingerprint, durability: 'volatile' };
}
