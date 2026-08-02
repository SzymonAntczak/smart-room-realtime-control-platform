import {
    type DeviceScenarioList,
    deviceScenarioListSchema,
    type EventProcessingDiagnosticsSnapshot,
    eventProcessingDiagnosticsSnapshotSchema,
    isSchema,
    type TemperatureScenarioAction,
    type TemperatureScenarioResult,
    temperatureScenarioResultSchema,
} from '@smart-room/contracts';

export type { TemperatureScenarioAction } from '@smart-room/contracts';

const defaultBffUrl = 'http://localhost:4310';

export interface TemperatureScenarioClient {
    runScenario(action: TemperatureScenarioAction): Promise<TemperatureScenarioResult>;
    getScenarios?(): Promise<DeviceScenarioList>;
    getDiagnostics(): Promise<EventProcessingDiagnosticsSnapshot>;
}

export function createTemperatureScenarioClient(
    fetchImplementation: typeof fetch = fetch,
    scenarioControlUrl = `${getBffUrl()}/dev/devices/temp-desk/scenarios`,
    diagnosticsUrl = `${getBffUrl()}/diagnostics`,
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
        async getScenarios() {
            const response = await fetchImplementation(scenarioControlUrl);

            if (!response.ok) {
                throw new Error(`Scenario discovery request failed (${response.status}).`);
            }

            const result: unknown = await response.json();
            if (!isSchema(deviceScenarioListSchema, result)) {
                throw new Error('Scenario discovery returned an invalid response.');
            }

            return result as DeviceScenarioList;
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

export function createDeviceScenarioClient(
    deviceId: string,
    fetchImplementation: typeof fetch = fetch,
): TemperatureScenarioClient {
    const baseUrl = getBffUrl();
    const client = createTemperatureScenarioClient(
        fetchImplementation,
        `${baseUrl}/dev/devices/${encodeURIComponent(deviceId)}/scenarios`,
        `${baseUrl}/diagnostics`,
    );

    return {
        ...client,
        async getScenarios() {
            const scenarios = await client.getScenarios!();

            if (scenarios.deviceId !== deviceId) {
                throw new Error('Scenario discovery returned scenarios for a different device.');
            }

            return scenarios;
        },
    };
}

function getBffUrl(): string {
    return (import.meta.env.VITE_BFF_URL ?? defaultBffUrl).replace(/\/+$/u, '');
}
