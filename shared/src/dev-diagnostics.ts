export const ignoredEventReasons = [
    'duplicate_event',
    'malformed_event',
    'unsupported_event_type',
    'unsupported_event_version',
    'unknown_device',
    'invalid_payload',
    'device_metric_mismatch',
    'future_dated_report',
] as const;

export type IgnoredEventReason = (typeof ignoredEventReasons)[number];

export interface IgnoredEventDiagnostic {
    diagnosticId: string;
    reason: IgnoredEventReason;
    observedAt: string;
    eventId?: string;
    eventType?: string;
    source?: string;
    deviceId?: string;
    commandId?: string;
    occurredAt?: string;
}

export interface EventProcessingDiagnosticsSnapshot {
    ignoredEvents: IgnoredEventDiagnostic[];
    deduplicationEvictions?: DeduplicationEvictionDiagnostic[];
}

export interface DeduplicationEvictionDiagnostic {
    diagnosticId: string;
    evictedEventId: string;
    observedAt: string;
}

export function isIgnoredEventReason(value: unknown): value is IgnoredEventReason {
    return typeof value === 'string' && ignoredEventReasons.some((reason) => reason === value);
}
