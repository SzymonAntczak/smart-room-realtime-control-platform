import { describe, expect, it } from 'vitest';
import type { EventProcessingResult } from './event-processor';
import { createEventProcessingDiagnostics } from './event-processing-diagnostics';

describe('createEventProcessingDiagnostics', () => {
    it('does not record accepted processing results', () => {
        const diagnostics = createDiagnostics();

        diagnostics.recordProcessingResult(createEvent(), {
            status: 'accepted',
            state: createEmptyState(),
        });

        expect(diagnostics.getSnapshot()).toEqual({
            ignoredEvents: [],
        });
    });

    it('records representative ignored reasons with event metadata', () => {
        const diagnostics = createDiagnostics({
            observedAt: ['2026-06-08T09:30:01Z', '2026-06-08T09:30:02Z'],
        });

        diagnostics.recordProcessingResult(createEvent({ eventId: 'evt-1' }), ignored('duplicate_event'));
        diagnostics.recordProcessingResult(
            createEvent({
                eventId: 'evt-2',
                eventType: 'unsupported.event',
            }),
            ignored('unsupported_event_type'),
        );

        expect(diagnostics.getSnapshot()).toEqual({
            ignoredEvents: [
                {
                    diagnosticId: 'diag-2',
                    reason: 'unsupported_event_type',
                    observedAt: '2026-06-08T09:30:02Z',
                    eventId: 'evt-2',
                    eventType: 'unsupported.event',
                    source: 'simulator-adapter',
                    deviceId: 'temp-desk',
                    occurredAt: '2026-06-08T09:30:00Z',
                },
                {
                    diagnosticId: 'diag-1',
                    reason: 'duplicate_event',
                    observedAt: '2026-06-08T09:30:01Z',
                    eventId: 'evt-1',
                    eventType: 'telemetry.reading.recorded',
                    source: 'simulator-adapter',
                    deviceId: 'temp-desk',
                    occurredAt: '2026-06-08T09:30:00Z',
                },
            ],
        });
    });

    it('keeps ignored diagnostics newest-first and applies the configured limit', () => {
        const diagnostics = createDiagnostics({
            diagnosticEventLimit: 2,
            observedAt: [
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:02Z',
                '2026-06-08T09:30:03Z',
            ],
        });

        diagnostics.recordProcessingResult(createEvent({ eventId: 'evt-1' }), ignored('duplicate_event'));
        diagnostics.recordProcessingResult(createEvent({ eventId: 'evt-2' }), ignored('invalid_payload'));
        diagnostics.recordProcessingResult(createEvent({ eventId: 'evt-3' }), ignored('unknown_device'));

        expect(diagnostics.getSnapshot().ignoredEvents.map((event) => event.diagnosticId)).toEqual([
            'diag-3',
            'diag-2',
        ]);
        expect(diagnostics.getSnapshot().ignoredEvents.map((event) => event.reason)).toEqual([
            'unknown_device',
            'invalid_payload',
        ]);
    });

    it('returns snapshots that cannot mutate internal diagnostics state', () => {
        const diagnostics = createDiagnostics({
            observedAt: ['2026-06-08T09:30:01Z'],
        });

        diagnostics.recordProcessingResult(createEvent(), ignored('duplicate_event'));

        const firstSnapshot = diagnostics.getSnapshot();
        firstSnapshot.ignoredEvents[0]!.reason = 'invalid_payload';
        firstSnapshot.ignoredEvents.push({
            diagnosticId: 'diag-mutated',
            reason: 'malformed_event',
            observedAt: '2026-06-08T09:30:02Z',
        });

        expect(diagnostics.getSnapshot()).toEqual({
            ignoredEvents: [
                {
                    diagnosticId: 'diag-1',
                    reason: 'duplicate_event',
                    observedAt: '2026-06-08T09:30:01Z',
                    eventId: 'evt-temperature-1',
                    eventType: 'telemetry.reading.recorded',
                    source: 'simulator-adapter',
                    deviceId: 'temp-desk',
                    occurredAt: '2026-06-08T09:30:00Z',
                },
            ],
        });
    });

    it('sanitizes metadata and never exposes payload contents', () => {
        const diagnostics = createDiagnostics({
            observedAt: ['2026-06-08T09:30:01Z'],
        });

        diagnostics.recordProcessingResult(
            {
                eventId: 123,
                eventType: 'telemetry.reading.recorded',
                version: 1,
                occurredAt: null,
                source: { adapter: 'simulator-adapter' },
                deviceId: 'temp-desk',
                commandId: ['cmd-1'],
                payload: {
                    secret: 'do-not-expose',
                },
            },
            ignored('malformed_event'),
        );

        expect(diagnostics.getSnapshot()).toEqual({
            ignoredEvents: [
                {
                    diagnosticId: 'diag-1',
                    reason: 'malformed_event',
                    observedAt: '2026-06-08T09:30:01Z',
                    eventType: 'telemetry.reading.recorded',
                    deviceId: 'temp-desk',
                },
            ],
        });
        expect(JSON.stringify(diagnostics.getSnapshot())).not.toContain('do-not-expose');
    });
});

function createDiagnostics({
    diagnosticEventLimit,
    observedAt = [],
}: {
    diagnosticEventLimit?: number;
    observedAt?: string[];
} = {}) {
    const pendingObservedAt = [...observedAt];

    return createEventProcessingDiagnostics({
        diagnosticEventLimit,
        clock: {
            now() {
                return pendingObservedAt.shift() ?? '2026-06-08T09:30:00Z';
            },
        },
    });
}

function ignored(reason: Extract<EventProcessingResult, { status: 'ignored' }>['reason']): EventProcessingResult {
    return {
        status: 'ignored',
        reason,
        state: createEmptyState(),
    };
}

function createEmptyState() {
    return {
        updatedAt: '2026-06-08T09:29:59Z',
        devices: [],
        activeCommands: [],
        recentEvents: [],
    };
}

function createEvent(overrides: Record<string, unknown> = {}) {
    return {
        eventId: 'evt-temperature-1',
        eventType: 'telemetry.reading.recorded',
        version: 1,
        occurredAt: '2026-06-08T09:30:00Z',
        source: 'simulator-adapter',
        deviceId: 'temp-desk',
        payload: {
            metric: 'temperature',
            value: 22,
            unit: 'celsius',
        },
        ...overrides,
    };
}
