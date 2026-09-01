import { describe, expect, it } from 'vitest';

import {
    commandDeliveryUncertainEventSchema,
    commandDispatchedEventSchema,
    commandFailedEventSchema,
    commandRequestedEventSchema,
    commandTimedOutEventSchema,
    deviceHealthChangedEventSchema,
    deviceStateReportedEventSchema,
    platformEventCandidateSchema,
    platformEventEnvelopeSchema,
    telemetryReadingRecordedEventSchema,
} from './events';
import { isSchema, normalizeIsoTimestamp } from './validation';

describe('platform event schemas', () => {
    it.each([
        [deviceStateReportedEventSchema, 'device.state.reported'],
        [deviceHealthChangedEventSchema, 'device.health.changed'],
        [telemetryReadingRecordedEventSchema, 'telemetry.reading.recorded'],
        [commandRequestedEventSchema, 'command.requested'],
        [commandDispatchedEventSchema, 'command.dispatched'],
        [commandDeliveryUncertainEventSchema, 'command.delivery_uncertain'],
        [commandFailedEventSchema, 'command.failed'],
        [commandTimedOutEventSchema, 'command.timed_out'],
    ] as const)('accepts its documented lifecycle event', (schema, eventType) => {
        expect(isSchema(schema, createEvent(eventType))).toBe(true);
    });

    it('requires a non-empty commandId on lifecycle events', () => {
        expect(
            isSchema(commandRequestedEventSchema, {
                ...createEvent('command.requested'),
                commandId: '',
            }),
        ).toBe(false);
    });

    it('normalizes accepted ISO timestamps with an offset to UTC', () => {
        const result = {
            ...createEvent('telemetry.reading.recorded'),
            occurredAt: '2026-06-08T11:30:00+02:00',
        };

        expect(isSchema(telemetryReadingRecordedEventSchema, result)).toBe(true);
        expect(normalizeIsoTimestamp(result.occurredAt)).toBe('2026-06-08T09:30:00Z');
    });

    it.each(['2026-02-30T09:30:00Z', '2025-02-29T09:30:00Z', '2026-13-01T09:30:00Z'])(
        'rejects an impossible ISO timestamp: %s',
        (occurredAt) => {
            expect(
                isSchema(telemetryReadingRecordedEventSchema, {
                    ...createEvent('telemetry.reading.recorded'),
                    occurredAt,
                }),
            ).toBe(false);
            expect(normalizeIsoTimestamp(occurredAt)).toBeUndefined();
        },
    );

    it('accepts a valid leap-day timestamp', () => {
        expect(normalizeIsoTimestamp('2028-02-29T09:30:00+02:00')).toBe('2028-02-29T07:30:00Z');
    });

    it('rejects unsupported event types from the full event contract', () => {
        expect(
            isSchema(platformEventEnvelopeSchema, {
                ...createEvent('telemetry.reading.recorded'),
                eventType: 'device.unknown',
            }),
        ).toBe(false);
    });

    it('preserves unknown event types for classification while normalizing their timestamp', () => {
        const candidate = {
            ...createEvent('telemetry.reading.recorded'),
            eventType: 'device.unknown',
            occurredAt: '2026-06-08T11:30:00+02:00',
        };

        expect(isSchema(platformEventCandidateSchema, candidate)).toBe(true);
        expect(isSchema(platformEventEnvelopeSchema, candidate)).toBe(false);
    });

    it('rejects semantically invalid set.power lifecycle facts', () => {
        expect(
            isSchema(commandRequestedEventSchema, {
                ...createEvent('command.requested'),
                payload: {
                    commandType: 'set.power',
                    requestedState: {},
                    requestedBy: 'user',
                },
            }),
        ).toBe(false);
        expect(
            isSchema(platformEventEnvelopeSchema, {
                ...createEvent('command.dispatched'),
                eventType: 'command.confirmed',
            }),
        ).toBe(false);
    });
});

function createEvent(eventType: string) {
    const base = {
        eventId: 'evt-1',
        occurredAt: '2026-06-08T09:30:00Z',
        source: 'backend',
        deviceId: 'led-main',
    };

    switch (eventType) {
        case 'device.state.reported':
            return {
                ...base,
                eventType,
                payload: { reportedState: { power: 'on' } },
            };
        case 'device.health.changed':
            return {
                ...base,
                eventType,
                payload: { previousHealth: 'degraded', health: 'healthy', reason: 'recovered' },
            };
        case 'telemetry.reading.recorded':
            return {
                ...base,
                eventType,
                payload: { metric: 'temperature', value: 22.5, unit: 'celsius' },
            };
        case 'command.requested':
            return {
                ...base,
                eventType,
                commandId: 'cmd-1',
                payload: {
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                    requestedBy: 'user',
                },
            };
        case 'command.dispatched':
            return {
                ...base,
                eventType,
                commandId: 'cmd-1',
                payload: { commandType: 'set.power', target: 'simulator-adapter' },
            };
        case 'command.delivery_uncertain':
            return {
                ...base,
                eventType,
                commandId: 'cmd-1',
                payload: {
                    commandType: 'set.power',
                    target: 'simulator-adapter',
                    reason: 'transport_ack_lost',
                },
            };
        case 'command.failed':
            return {
                ...base,
                eventType,
                commandId: 'cmd-1',
                payload: {
                    reason: 'command_already_active',
                    message: 'Device has an active command.',
                },
            };
        case 'command.timed_out':
            return {
                ...base,
                eventType,
                commandId: 'cmd-1',
                payload: { timeoutMs: 5000, reason: 'confirmation_not_received' },
            };
        default:
            throw new Error(`Unsupported event type: ${eventType}`);
    }
}
