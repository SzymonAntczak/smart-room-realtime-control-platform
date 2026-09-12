import { type Static, Type } from '@sinclair/typebox';

import { historyGenerationIdSchema } from './storage';
import { canonicalUtcTimestampSchema, isSchema } from './validation';

export const ignoredEventReasons = [
    'duplicate_event',
    'malformed_event',
    'unsupported_event_type',
    'unknown_device',
    'invalid_payload',
    'invalid_lifecycle_transition',
    'device_metric_mismatch',
    'future_dated_report',
    'stale_device_transition',
    'event_identity_conflict',
] as const;
export type IgnoredEventReason = (typeof ignoredEventReasons)[number];

export const ignoredEventReasonSchema = Type.Union(
    ignoredEventReasons.map((reason) => Type.Literal(reason)),
);

/** Retained, metadata-only record of a quarantined or non-applying input. */
export const durableDiagnosticEntrySchema = Type.Object(
    {
        internalSequence: Type.Integer({ minimum: 1 }),
        reason: ignoredEventReasonSchema,
        recordedAt: canonicalUtcTimestampSchema,
        eventId: Type.Optional(Type.String()),
        eventType: Type.Optional(Type.String()),
        source: Type.Optional(Type.String()),
        deviceId: Type.Optional(Type.String()),
        commandId: Type.Optional(Type.String()),
        occurredAt: Type.Optional(canonicalUtcTimestampSchema),
    },
    { additionalProperties: false },
);
export type DurableDiagnosticEntry = Static<typeof durableDiagnosticEntrySchema>;

export const durableDiagnosticsLimit = 1_000;
export const durableDiagnosticsSnapshotSchema = Type.Object(
    {
        historyGenerationId: historyGenerationIdSchema,
        entries: Type.Array(durableDiagnosticEntrySchema, { maxItems: durableDiagnosticsLimit }),
    },
    { additionalProperties: false },
);
export type DurableDiagnosticsSnapshot = Static<typeof durableDiagnosticsSnapshotSchema>;

export function isIgnoredEventReason(value: unknown): value is IgnoredEventReason {
    return typeof value === 'string' && ignoredEventReasons.some((reason) => reason === value);
}

/** Validates diagnostics ordering and uniqueness beyond the structural schema. */
export function isDurableDiagnosticsSnapshot(value: unknown): value is DurableDiagnosticsSnapshot {
    if (!isSchema(durableDiagnosticsSnapshotSchema, value)) {
        return false;
    }

    return (
        new Set(value.entries.map((entry) => entry.internalSequence)).size ===
            value.entries.length &&
        value.entries.every((entry, index) => {
            const next = value.entries[index + 1];

            if (!next) {
                return true;
            }

            const timestampOrder = Date.parse(next.recordedAt) - Date.parse(entry.recordedAt);

            return (
                timestampOrder < 0 ||
                (timestampOrder === 0 && entry.internalSequence > next.internalSequence)
            );
        })
    );
}
