import type {
    DeduplicationEvictionDiagnostic,
    EventProcessingDiagnosticsSnapshot,
    IgnoredEventDiagnostic,
} from '@smart-room/contracts/development';
import { normalizeIsoTimestamp } from '@smart-room/contracts/validation';

import type { EventProcessingResult } from './event-processor';

export type {
    EventProcessingDiagnosticsSnapshot,
    IgnoredEventDiagnostic,
} from '@smart-room/contracts/development';

export interface EventProcessingDiagnosticsClock {
    now(): string;
}

export interface EventProcessingDiagnosticsConfig {
    clock: EventProcessingDiagnosticsClock;
    diagnosticEventLimit?: number;
}

export interface EventProcessingDiagnostics {
    recordProcessingResult(event: unknown, result: EventProcessingResult): void;
    getSnapshot(): EventProcessingDiagnosticsSnapshot;
}

export function createEventProcessingDiagnostics({
    clock,
    diagnosticEventLimit = 50,
}: EventProcessingDiagnosticsConfig): EventProcessingDiagnostics {
    const ignoredEvents: IgnoredEventDiagnostic[] = [];
    const deduplicationEvictions: DeduplicationEvictionDiagnostic[] = [];
    let nextDiagnosticNumber = 1;

    return {
        recordProcessingResult(event, result) {
            if (result.status === 'accepted') {
                for (const evictedEventId of result.deduplicationEvictedEventIds ?? []) {
                    deduplicationEvictions.unshift({
                        diagnosticId: `dedupe-${nextDiagnosticNumber}`,
                        evictedEventId,
                        observedAt: normalizeClockTimestamp(clock.now()),
                    });
                    nextDiagnosticNumber += 1;
                }
                deduplicationEvictions.splice(diagnosticEventLimit);
                return;
            }

            ignoredEvents.unshift({
                diagnosticId: `diag-${nextDiagnosticNumber}`,
                reason: result.reason,
                observedAt: normalizeClockTimestamp(clock.now()),
                ...toEventMetadata(event),
            });
            nextDiagnosticNumber += 1;
            ignoredEvents.splice(diagnosticEventLimit);
        },
        getSnapshot() {
            return {
                ignoredEvents: ignoredEvents.map((event) => ({ ...event })),
                ...(deduplicationEvictions.length > 0
                    ? {
                          deduplicationEvictions: deduplicationEvictions.map((event) => ({
                              ...event,
                          })),
                      }
                    : {}),
            };
        },
    };
}

function toEventMetadata(event: unknown): Partial<IgnoredEventDiagnostic> {
    if (!isRecord(event)) {
        return {};
    }

    return {
        eventId: typeof event.eventId === 'string' ? event.eventId : undefined,
        eventType: typeof event.eventType === 'string' ? event.eventType : undefined,
        source: typeof event.source === 'string' ? event.source : undefined,
        deviceId: typeof event.deviceId === 'string' ? event.deviceId : undefined,
        commandId: typeof event.commandId === 'string' ? event.commandId : undefined,
        ...(typeof event.occurredAt === 'string'
            ? optionalNormalizedTimestamp(event.occurredAt)
            : {}),
    };
}

function normalizeClockTimestamp(timestamp: string): string {
    const normalizedTimestamp = normalizeIsoTimestamp(timestamp);

    if (!normalizedTimestamp) {
        throw new Error('Event processing diagnostics clock returned an invalid ISO timestamp.');
    }

    return normalizedTimestamp;
}

function optionalNormalizedTimestamp(
    timestamp: string,
): Pick<IgnoredEventDiagnostic, 'occurredAt'> {
    const normalizedTimestamp = normalizeIsoTimestamp(timestamp);

    return normalizedTimestamp ? { occurredAt: normalizedTimestamp } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
