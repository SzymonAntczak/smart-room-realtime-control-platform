import {
    isTemperatureScenarioAction,
    type TemperatureScenarioResult,
} from '../../../../../shared/src/dev-scenarios';
import type { TemperatureScenarioAction } from '../../../../../shared/src/dev-scenarios';
import {
    isIgnoredEventReason,
    type EventProcessingDiagnosticsSnapshot,
    type IgnoredEventDiagnostic,
} from '../../../../../shared/src/dev-diagnostics';

export type { TemperatureScenarioAction } from '../../../../../shared/src/dev-scenarios';

const defaultScenarioControlUrl = 'http://localhost:4310/dev/scenarios/temperature';
const defaultDiagnosticsUrl = 'http://localhost:4310/diagnostics';

export interface TemperatureScenarioClient {
    runScenario(action: TemperatureScenarioAction): Promise<TemperatureScenarioResult>;
    getDiagnostics(): Promise<EventProcessingDiagnosticsSnapshot>;
}

export function createTemperatureScenarioClient(
    fetchImplementation: typeof fetch = fetch,
    scenarioControlUrl = getScenarioControlUrl(),
    diagnosticsUrl = getDiagnosticsUrl(),
): TemperatureScenarioClient {
    return {
        async runScenario(action) {
            const response = await fetchImplementation(scenarioControlUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ action }),
            });

            if (!response.ok) {
                throw new Error(`Scenario control request failed (${response.status}).`);
            }

            const result: unknown = await response.json();

            if (!isTemperatureScenarioResult(result)) {
                throw new Error('Scenario control returned an invalid response.');
            }

            if (result.action !== action) {
                throw new Error('Scenario control returned a response for a different action.');
            }

            return result;
        },
        async getDiagnostics() {
            const response = await fetchImplementation(diagnosticsUrl);

            if (!response.ok) {
                throw new Error(`Diagnostics request failed (${response.status}).`);
            }

            const snapshot: unknown = await response.json();

            if (!isDiagnosticsSnapshot(snapshot)) {
                throw new Error('Diagnostics returned an invalid response.');
            }

            return snapshot;
        },
    };
}

export const temperatureScenarioClient = createTemperatureScenarioClient();

function getScenarioControlUrl(): string {
    return import.meta.env.VITE_TEMPERATURE_SCENARIO_CONTROL_URL ?? defaultScenarioControlUrl;
}

function getDiagnosticsUrl(): string {
    return import.meta.env.VITE_DIAGNOSTICS_URL ?? defaultDiagnosticsUrl;
}

function isTemperatureScenarioResult(value: unknown): value is TemperatureScenarioResult {
    return (
        typeof value === 'object' &&
        value !== null &&
        'action' in value &&
        'status' in value &&
        isTemperatureScenarioAction(value.action) &&
        value.status === 'completed'
    );
}

function isDiagnosticsSnapshot(value: unknown): value is EventProcessingDiagnosticsSnapshot {
    return (
        isRecord(value) &&
        Array.isArray(value.ignoredEvents) &&
        value.ignoredEvents.every(isIgnoredEventDiagnostic)
    );
}

function isIgnoredEventDiagnostic(value: unknown): value is IgnoredEventDiagnostic {
    return (
        isRecord(value) &&
        typeof value.diagnosticId === 'string' &&
        isIgnoredEventReason(value.reason) &&
        isIsoTimestamp(value.observedAt) &&
        isOptionalString(value.eventId) &&
        isOptionalString(value.eventType) &&
        isOptionalString(value.source) &&
        isOptionalString(value.deviceId) &&
        isOptionalString(value.commandId) &&
        isOptionalTimestamp(value.occurredAt)
    );
}

function isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === 'string';
}

function isOptionalTimestamp(value: unknown): boolean {
    return value === undefined || isIsoTimestamp(value);
}

function isIsoTimestamp(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
        !Number.isNaN(Date.parse(value))
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
