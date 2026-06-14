import type { EventProcessingResult, IgnoredEventReason } from './event-processor';

export interface EventProcessingDiagnosticsClock {
    now(): string;
}

export interface EventProcessingDiagnosticsConfig {
    clock: EventProcessingDiagnosticsClock;
    diagnosticEventLimit?: number;
}

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
    let nextDiagnosticNumber = 1;

    return {
        recordProcessingResult(event, result) {
            if (result.status !== 'ignored') {
                return;
            }

            ignoredEvents.unshift({
                diagnosticId: `diag-${nextDiagnosticNumber}`,
                reason: result.reason,
                observedAt: clock.now(),
                ...toEventMetadata(event),
            });
            nextDiagnosticNumber += 1;
            ignoredEvents.splice(diagnosticEventLimit);
        },
        getSnapshot() {
            return {
                ignoredEvents: ignoredEvents.map((event) => ({ ...event })),
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
        occurredAt: typeof event.occurredAt === 'string' ? event.occurredAt : undefined,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
