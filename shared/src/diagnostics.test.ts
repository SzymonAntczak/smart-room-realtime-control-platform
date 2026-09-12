import { describe, expect, it } from 'vitest';

import { isDurableDiagnosticsSnapshot } from './diagnostics';

describe('durable diagnostics contracts', () => {
    it('accepts bounded newest-first metadata-only diagnostics', () => {
        const later = diagnostic(2, '2026-09-10T10:00:00.000Z');
        const earlier = diagnostic(1, '2026-09-10T09:00:00.000Z');

        expect(
            isDurableDiagnosticsSnapshot({
                historyGenerationId: 'generation-1',
                entries: [later, earlier],
            }),
        ).toBe(true);
    });

    it('rejects unordered, duplicate, oversized and raw-event diagnostics', () => {
        const later = diagnostic(2, '2026-09-10T10:00:00.000Z');
        const earlier = diagnostic(1, '2026-09-10T09:00:00.000Z');
        const snapshot = { historyGenerationId: 'generation-1', entries: [later, earlier] };

        expect(isDurableDiagnosticsSnapshot({ ...snapshot, entries: [earlier, later] })).toBe(
            false,
        );
        expect(isDurableDiagnosticsSnapshot({ ...snapshot, entries: [later, later] })).toBe(false);
        expect(
            isDurableDiagnosticsSnapshot({
                ...snapshot,
                entries: [{ ...later, recordedAt: '2026-09-10T12:00:00+02:00' }],
            }),
        ).toBe(false);
        expect(
            isDurableDiagnosticsSnapshot({
                ...snapshot,
                entries: Array.from({ length: 1_001 }, () => later),
            }),
        ).toBe(false);
        expect(
            isDurableDiagnosticsSnapshot({
                ...snapshot,
                entries: [{ ...later, rawEvent: { secret: 'must-not-cross-the-boundary' } }],
            }),
        ).toBe(false);
    });
});

function diagnostic(internalSequence: number, recordedAt: string) {
    return {
        internalSequence,
        reason: 'future_dated_report' as const,
        recordedAt,
        eventId: `evt-${internalSequence}`,
        eventType: 'telemetry.reading.recorded',
        source: 'simulator-adapter',
        deviceId: 'temp-desk',
        occurredAt: '2026-09-10T10:00:02.000Z',
    };
}
