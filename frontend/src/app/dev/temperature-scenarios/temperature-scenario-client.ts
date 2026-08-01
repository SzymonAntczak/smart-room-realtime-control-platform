import {
    type EventProcessingDiagnosticsSnapshot,
    eventProcessingDiagnosticsSnapshotSchema,
    isSchema,
    type TemperatureScenarioAction,
    type TemperatureScenarioResult,
    temperatureScenarioResultSchema,
} from '@smart-room/contracts';

export type { TemperatureScenarioAction } from '@smart-room/contracts';

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

            if (!isSchema(temperatureScenarioResultSchema, result)) {
                throw new Error('Scenario control returned an invalid response.');
            }

            if (result.action !== action) {
                throw new Error('Scenario control returned a response for a different action.');
            }

            return result as TemperatureScenarioResult;
        },
        async getDiagnostics() {
            const response = await fetchImplementation(diagnosticsUrl);

            if (!response.ok) {
                throw new Error(`Diagnostics request failed (${response.status}).`);
            }

            const snapshot: unknown = await response.json();

            if (!isSchema(eventProcessingDiagnosticsSnapshotSchema, snapshot)) {
                throw new Error('Diagnostics returned an invalid response.');
            }

            return snapshot as EventProcessingDiagnosticsSnapshot;
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
