import { createHash } from 'node:crypto';

import type { PlatformEvent } from '@smart-room/contracts/events';
import { normalizeIsoTimestamp } from '@smart-room/contracts/validation';

export type InputFingerprint = `fp:v1:sha256:${string}`;
export type LogicalRecordId = `rec:v1:sha256:${string}`;

export function inputFingerprint(event: PlatformEvent): InputFingerprint {
    const occurredAt = normalizeIsoTimestamp(event.occurredAt);

    if (!occurredAt) {
        throw new Error('Validated platform event has an invalid occurredAt timestamp.');
    }

    return `fp:v1:sha256:${sha256(
        canonicalJson({
            eventType: event.eventType,
            occurredAt,
            source: event.source,
            deviceId: event.deviceId,
            commandId: event.commandId,
            payload: semanticPayload(event),
        }),
    )}`;
}

/** Keeps input identity bound to validated semantics rather than tolerated extras. */
function semanticPayload(event: PlatformEvent): unknown {
    switch (event.eventType) {
        case 'device.state.reported':
            return { reportedState: event.payload.reportedState };
        case 'device.availability.changed':
            return {
                previousAvailability: event.payload.previousAvailability,
                availability: event.payload.availability,
                reason: event.payload.reason,
            };
        case 'device.health.changed':
            return {
                previousHealth: event.payload.previousHealth,
                health: event.payload.health,
                reason: event.payload.reason,
            };
        case 'telemetry.reading.recorded':
            return {
                metric: event.payload.metric,
                value: event.payload.value,
                unit: event.payload.unit,
            };
        case 'command.requested':
            return {
                commandType: event.payload.commandType,
                requestedState: event.payload.requestedState,
                requestedBy: event.payload.requestedBy,
            };
        case 'command.dispatched':
            return { commandType: event.payload.commandType, target: event.payload.target };
        case 'command.failed':
            return {
                reason: event.payload.reason,
                message: event.payload.message,
                commandType: event.payload.commandType,
                requestedState: event.payload.requestedState,
                requestedAt: event.payload.requestedAt,
            };
        case 'command.timed_out':
            return { timeoutMs: event.payload.timeoutMs, reason: event.payload.reason };
    }
}

export function logicalRecordId(event: PlatformEvent, recordKind: string): LogicalRecordId {
    return `rec:v1:sha256:${sha256(
        canonicalJson({ source: event.source, eventId: event.eventId, recordKind }),
    )}`;
}

export function derivedCommandRecordId(commandId: string, lifecycleKind: string): LogicalRecordId {
    return `rec:v1:sha256:${sha256(
        canonicalJson({
            family: 'derived_command_lifecycle',
            commandId,
            lifecycleKind,
        }),
    )}`;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
        return JSON.stringify(value);
    }

    if (typeof value === 'string') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }

    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const entries = Object.entries(record)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));

        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
    }

    throw new Error('Input fingerprint requires JSON-compatible values.');
}
