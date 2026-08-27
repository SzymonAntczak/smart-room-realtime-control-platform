import { describe, expect, it } from 'vitest';

import { createRoomProjector } from '../read-model/room-projection';

import { createEventProcessor } from './event-processor';

function processor(
    acceptedInputIdentities: Parameters<
        typeof createEventProcessor
    >[0]['acceptedInputIdentities'] = [],
) {
    return createEventProcessor({
        devices: [{ deviceId: 'temp-desk', name: 'Desk Temperature', role: 'temperature-sensor' }],
        roomProjector: createRoomProjector({
            devices: [
                { deviceId: 'temp-desk', name: 'Desk Temperature', role: 'temperature-sensor' },
            ],
            initialUpdatedAt: '2026-06-08T09:29:59Z',
        }),
        clock: { now: () => '2026-06-08T09:30:00Z' },
        acceptedInputIdentities,
    });
}

function ledProcessor() {
    return createEventProcessor({
        devices: [{ deviceId: 'led-main', name: 'Main LED', role: 'led-output' }],
        roomProjector: createRoomProjector({
            devices: [{ deviceId: 'led-main', name: 'Main LED', role: 'led-output' }],
            initialUpdatedAt: '2026-06-08T09:29:59Z',
        }),
        clock: { now: () => '2026-06-08T09:30:02Z' },
    });
}

describe('createEventProcessor', () => {
    it('keeps the live projection and duplicate guard unchanged while preparing', () => {
        const room = processor();
        const event = {
            eventId: 'prepared-reading-1',
            eventType: 'telemetry.reading.recorded',
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { metric: 'temperature', value: 22.5, unit: 'celsius' },
        } as const;
        const ingress = { receivedAt: '2026-06-08T09:30:00Z', ingestSequence: 1 };

        const first = room.prepareEvent(event, ingress);
        const second = room.prepareEvent(event, ingress);

        expect(first.kind).toBe('accepted_applied');
        expect(second.kind).toBe('accepted_applied');
        expect(first.result.state.devices[0]?.reportedState).toEqual({
            temperature: 22.5,
            temperatureUnit: 'celsius',
        });
        expect(
            room.processEvent({
                ...event,
                eventId: 'independent-reading',
                payload: { metric: 'temperature', value: 22.4, unit: 'celsius' },
            }).state.devices[0]?.reportedState,
        ).toEqual({
            temperature: 22.4,
            temperatureUnit: 'celsius',
        });

        room.commitPrepared(first);

        expect(room.prepareEvent(event, ingress)).toMatchObject({
            kind: 'quarantined',
            result: { status: 'ignored', reason: 'duplicate_event' },
        });
    });

    it('does not prune a volatile guard while preparing another input', () => {
        const room = processor();
        const guarded = {
            eventId: 'guarded-event',
            eventType: 'telemetry.reading.recorded',
            occurredAt: '2026-06-08T09:20:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { metric: 'temperature', value: 22.5, unit: 'celsius' },
        } as const;
        const guardIngress = { receivedAt: '2026-06-08T09:20:00Z', ingestSequence: 1 };
        const fingerprint = room.prepareEvent(guarded, guardIngress).fingerprint;

        room.rememberVolatileIdentity(
            guarded.eventId,
            fingerprint ?? 'fp:v1:sha256:test',
            guardIngress.receivedAt,
        );
        room.prepareEvent(
            {
                ...guarded,
                eventId: 'later-prepared-event',
                occurredAt: '2026-06-08T09:31:00Z',
            },
            { receivedAt: '2026-06-08T09:31:00Z', ingestSequence: 2 },
        );

        expect(room.prepareEvent(guarded, guardIngress, 'degraded')).toMatchObject({
            kind: 'quarantined',
            result: { reason: 'duplicate_event' },
        });
    });

    it('materializes an accepted candidate projection at captured ingress time', () => {
        const room = processor();
        const prepared = room.prepareEvent(
            {
                eventId: 'telemetry-near-freshness-boundary',
                eventType: 'telemetry.reading.recorded',
                occurredAt: '2026-06-08T09:30:00Z',
                source: 'simulator-adapter',
                deviceId: 'temp-desk',
                payload: { metric: 'temperature', value: 22.5, unit: 'celsius' },
            },
            { receivedAt: '2026-06-08T09:30:03Z', ingestSequence: 1 },
        );

        expect(prepared).toMatchObject({
            kind: 'accepted_applied',
            candidateState: {
                devices: [
                    {
                        observationStatus: {
                            temperature: {
                                freshness: 'stale',
                                lastObservedAt: '2026-06-08T09:30:00Z',
                            },
                        },
                    },
                ],
            },
        });
    });

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
    it('promotes only exact volatile availability evidence during durable reconciliation', () => {
        const room = processor();
        const event = {
            eventId: 'availability-volatile',
            eventType: 'device.availability.changed',
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: {
                previousAvailability: 'unknown',
                availability: 'online',
                reason: 'simulator_started',
            },
        } as const;
        const ingress = { receivedAt: '2026-06-08T09:30:00Z', ingestSequence: 1 };
        const volatilePrepared = room.prepareEvent(event, ingress, 'degraded');

        room.commitPrepared(volatilePrepared, 'volatile');
        room.rememberVolatileIdentity(
            event.eventId,
            volatilePrepared.fingerprint ?? 'fp:v1:sha256:test',
            ingress.receivedAt,
        );

        const reconciliation = room.prepareEvent(event, ingress, 'available');
        const durableState = room.materializePreparedState(reconciliation, 'durable');

        expect(reconciliation.kind).toBe('accepted_non_applying');
        expect(durableState.devices[0]).toMatchObject({ availabilityDurability: 'durable' });
        expect(room.materializePreparedState(reconciliation, 'volatile').devices[0]).toMatchObject({
            availabilityDurability: 'volatile',
        });
    });

    it('uses a restored volatile guard to reject duplicate input while degraded', () => {
        const event = {
            eventId: 'restored-volatile-event',
            eventType: 'telemetry.reading.recorded',
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { metric: 'temperature', value: 22.5, unit: 'celsius' },
        } as const;
        const ingress = { receivedAt: '2026-06-08T09:30:00Z', ingestSequence: 1 };
        const fingerprint = processor().prepareEvent(event, ingress).fingerprint;

        const restored = processor([
            {
                eventId: event.eventId,
                fingerprint: fingerprint ?? 'fp:v1:sha256:test',
                durability: 'volatile',
                acceptedAt: ingress.receivedAt,
            },
        ]);

        expect(restored.prepareEvent(event, ingress, 'degraded')).toMatchObject({
            kind: 'quarantined',
            result: { reason: 'duplicate_event' },
        });
    });

    it('persists the derived confirmation and promotes only its lifecycle on reconciliation', () => {
        const room = ledProcessor();
        const requested = {
            eventId: 'volatile-command-requested',
            eventType: 'command.requested',
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'backend',
            deviceId: 'led-main',
            commandId: 'command-1',
            payload: {
                commandType: 'set.power',
                requestedState: { power: 'on' },
                requestedBy: 'user',
            },
        } as const;
        const dispatched = {
            eventId: 'volatile-command-dispatched',
            eventType: 'command.dispatched',
            occurredAt: '2026-06-08T09:30:01Z',
            source: 'backend',
            deviceId: 'led-main',
            commandId: 'command-1',
            payload: { commandType: 'set.power', target: 'simulator-adapter' },
        } as const;
        const report = {
            eventId: 'volatile-confirming-report',
            eventType: 'device.state.reported',
            occurredAt: '2026-06-08T09:30:02Z',
            source: 'simulator-adapter',
            deviceId: 'led-main',
            payload: { reportedState: { power: 'on' } },
        } as const;

        for (const [event, receivedAt] of [
            [requested, '2026-06-08T09:30:00Z'],
            [dispatched, '2026-06-08T09:30:01Z'],
            [report, '2026-06-08T09:30:02Z'],
        ] as const) {
            const prepared = room.prepareEvent(
                event,
                { receivedAt, ingestSequence: 1 },
                'degraded',
            );
            room.commitPrepared(prepared, 'volatile');

            if (prepared.eventId && prepared.fingerprint) {
                room.rememberVolatileIdentity(prepared.eventId, prepared.fingerprint, receivedAt);
            }
        }

        const reconciliation = room.prepareEvent(
            report,
            { receivedAt: '2026-06-08T09:30:02Z', ingestSequence: 2 },
            'available',
        );
        const durableState = room.materializePreparedState(reconciliation, 'durable');

        expect(reconciliation.records).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'input_significant_fact' }),
                expect.objectContaining({
                    kind: 'derived_command_confirmed',
                    commandId: 'command-1',
                    payload: { sourceEventId: report.eventId, confirmedAt: report.occurredAt },
                }),
            ]),
        );
        expect(durableState.recentCommands).toEqual([
            expect.objectContaining({
                commandId: 'command-1',
                durability: 'volatile',
                lifecycleDurability: 'durable',
            }),
        ]);
    });

    it('normalizes semantic payload timestamps before fingerprinting identity reuse', () => {
        const room = processor();
        const base = {
            eventId: 'failure-with-offset',
            eventType: 'command.failed',
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'backend',
            deviceId: 'temp-desk',
            commandId: 'cmd-1',
            payload: {
                reason: 'adapter_rejected',
                message: 'Rejected.',
                commandType: 'set.power',
                requestedState: { power: 'on' },
                requestedAt: '2026-06-08T11:30:00+02:00',
            },
        } as const;
        const ingress = { receivedAt: '2026-06-08T09:30:00Z', ingestSequence: 1 };
        const first = room.prepareEvent(base, ingress);

        room.rememberDurableIdentity(
            base.eventId,
            first.fingerprint ?? 'fp:v1:sha256:test',
            ingress.receivedAt,
        );

        expect(
            room.prepareEvent(
                {
                    ...base,
                    payload: { ...base.payload, requestedAt: '2026-06-08T09:30:00Z' },
                },
                ingress,
            ),
        ).toMatchObject({ result: { reason: 'duplicate_event' } });
    });

    it('excludes contract-ignored envelope and payload extras from input fingerprints', () => {
        const room = processor();
        const event = {
            eventId: 'telemetry-with-extras',
            eventType: 'telemetry.reading.recorded',
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { metric: 'temperature', value: 22, unit: 'celsius' },
        } as const;
        const ingress = { receivedAt: '2026-06-08T09:30:00Z', ingestSequence: 1 };
        const first = room.prepareEvent(event, ingress);

        room.rememberDurableIdentity(
            event.eventId,
            first.fingerprint ?? 'fp:v1:sha256:test',
            ingress.receivedAt,
        );

        expect(
            room.prepareEvent(
                {
                    ...event,
                    ignoredEnvelopeExtra: 'trace-1',
                    payload: { ...event.payload, ignoredPayloadExtra: 'trace-2' },
                },
                ingress,
            ),
        ).toMatchObject({ result: { reason: 'duplicate_event' } });
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
    it('rejects first availability and health evidence older than the bootstrap timestamp', () => {
        const room = processor();
        const olderAt = '2026-06-08T09:29:58Z';

        const availabilityResult = room.processEvent({
            eventId: 'availability-older',
            eventType: 'device.availability.changed',
            occurredAt: olderAt,
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: {
                previousAvailability: 'unknown',
                availability: 'online',
                reason: 'simulator_started',
            },
        });
        const healthResult = room.processEvent({
            eventId: 'health-older',
            eventType: 'device.health.changed',
            occurredAt: olderAt,
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { previousHealth: 'unknown', health: 'healthy', reason: 'started' },
        });

        expect(availabilityResult).toMatchObject({
            status: 'ignored',
            reason: 'stale_device_transition',
        });
        expect(healthResult).toMatchObject({
            status: 'ignored',
            reason: 'stale_device_transition',
        });
        expect(healthResult.state.devices[0]).toMatchObject({
            availability: 'unknown',
            health: 'unknown',
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
            temperature: { freshness: 'unknown', durability: 'durable' },
        });
    });
});
