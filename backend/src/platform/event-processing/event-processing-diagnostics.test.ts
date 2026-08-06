import { eventProcessingDiagnosticsSnapshotSchema } from '@smart-room/contracts/development';
import { isSchema } from '@smart-room/contracts/validation';
import { describe, expect, it } from 'vitest';

import { createEventProcessingDiagnostics } from './event-processing-diagnostics';
import type { EventProcessingResult } from './event-processor';

describe('createEventProcessingDiagnostics', () => {
    it('does not record accepted processing results', () => {
        const diagnostics = createDiagnostics();

        diagnostics.recordProcessingResult(createEvent(), {
            status: 'accepted',
            evaluatedAt: '2026-06-08T09:30:00Z',
            state: createEmptyState(),
        });

        expect(diagnostics.getSnapshot()).toEqual({
            ignoredEvents: [],
        });
    });

    it('records deduplication evictions from accepted processing results', () => {
        const diagnostics = createDiagnostics({
            observedAt: ['2026-06-08T09:30:01Z', '2026-06-08T09:30:02Z'],
        });

        diagnostics.recordProcessingResult(createEvent(), {
            status: 'accepted',
            evaluatedAt: '2026-06-08T09:30:00Z',
            state: createEmptyState(),
            deduplicationEvictedEventIds: ['evt-1', 'evt-2'],
        });

        expect(diagnostics.getSnapshot()).toEqual({
            ignoredEvents: [],
            deduplicationEvictions: [
                {
                    diagnosticId: 'dedupe-2',
                    evictedEventId: 'evt-2',
                    observedAt: '2026-06-08T09:30:02Z',
                },
                {
                    diagnosticId: 'dedupe-1',
                    evictedEventId: 'evt-1',
                    observedAt: '2026-06-08T09:30:01Z',
                },
            ],
        });
    });

    it('records representative ignored reasons with event metadata', () => {
        const diagnostics = createDiagnostics({
            observedAt: ['2026-06-08T09:30:01Z', '2026-06-08T09:30:02Z'],
        });

        diagnostics.recordProcessingResult(
            createEvent({ eventId: 'evt-1' }),
            ignored('duplicate_event'),
        );
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
            observedAt: ['2026-06-08T09:30:01Z', '2026-06-08T09:30:02Z', '2026-06-08T09:30:03Z'],
        });

        diagnostics.recordProcessingResult(
            createEvent({ eventId: 'evt-1' }),
            ignored('duplicate_event'),
        );
        diagnostics.recordProcessingResult(
            createEvent({ eventId: 'evt-2' }),
            ignored('invalid_payload'),
        );
        diagnostics.recordProcessingResult(
            createEvent({ eventId: 'evt-3' }),
            ignored('unknown_device'),
        );

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

    it('normalizes valid metadata timestamps and omits invalid raw timestamps', () => {
        const diagnostics = createDiagnostics({
            observedAt: ['2026-06-08T11:30:01+02:00', '2026-06-08T11:30:02+02:00'],
        });

        diagnostics.recordProcessingResult(
            createEvent({ occurredAt: '2026-06-08T11:30:00+02:00' }),
            ignored('duplicate_event'),
        );
        diagnostics.recordProcessingResult(
            createEvent({ occurredAt: 'not-a-timestamp' }),
            ignored('malformed_event'),
        );

        const snapshot = diagnostics.getSnapshot();

        expect(snapshot.ignoredEvents).toMatchObject([
            { observedAt: '2026-06-08T09:30:02Z' },
            {
                observedAt: '2026-06-08T09:30:01Z',
                occurredAt: '2026-06-08T09:30:00Z',
            },
        ]);
        expect(snapshot.ignoredEvents[0]?.occurredAt).toBeUndefined();
        expect(isSchema(eventProcessingDiagnosticsSnapshotSchema, snapshot)).toBe(true);
    });

    it('records future-dated reports with normalized metadata', () => {
        const diagnostics = createDiagnostics({
            observedAt: ['2026-06-08T11:30:02+02:00'],
        });

        diagnostics.recordProcessingResult(
            createEvent({ occurredAt: '2026-06-08T11:30:01+02:00' }),
            ignored('future_dated_report'),
        );

        expect(diagnostics.getSnapshot()).toEqual({
            ignoredEvents: [
                {
                    diagnosticId: 'diag-1',
                    reason: 'future_dated_report',
                    observedAt: '2026-06-08T09:30:02Z',
                    eventId: 'evt-temperature-1',
                    eventType: 'telemetry.reading.recorded',
                    source: 'simulator-adapter',
                    deviceId: 'temp-desk',
                    occurredAt: '2026-06-08T09:30:01Z',
                },
            ],
        });
    });

    it('rejects an invalid injected diagnostics clock timestamp', () => {
        const diagnostics = createDiagnostics({
            observedAt: ['not-a-timestamp'],
        });

        expect(() => {
            diagnostics.recordProcessingResult(createEvent(), ignored('duplicate_event'));
        }).toThrow('Event processing diagnostics clock returned an invalid ISO timestamp.');
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

function ignored(
    reason: Extract<EventProcessingResult, { status: 'ignored' }>['reason'],
): EventProcessingResult {
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
        recentCommands: [],
    };
}

function createEvent(overrides: Record<string, unknown> = {}) {
    return {
        eventId: 'evt-temperature-1',
        eventType: 'telemetry.reading.recorded',
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
