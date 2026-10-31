import {
    type DeviceScenarioList,
    deviceScenarioListSchema,
    type DeviceScenarioResult,
    deviceScenarioResultSchema,
} from '@smart-room/contracts/development';
import {
    type DurableDiagnosticsSnapshot,
    isDurableDiagnosticsSnapshot,
} from '@smart-room/contracts/diagnostics';
import { isSchema } from '@smart-room/contracts/validation';

const defaultBffUrl = 'http://localhost:4310';

export interface DeviceScenarioClient {
    getDiagnostics(): Promise<DurableDiagnosticsSnapshot>;
    getScenarios(): Promise<DeviceScenarioList>;
    runScenario(action: DeviceScenarioResult['action']): Promise<DeviceScenarioResult>;
}

export function createDeviceScenarioClient(
    deviceId: string,
    fetchImplementation: typeof fetch = fetch,
): DeviceScenarioClient {
    const baseUrl = getBffUrl();
    const scenarioUrl = `${baseUrl}/dev/devices/${encodeURIComponent(deviceId)}/scenarios`;

    return {
        async getScenarios() {
            const response = await fetchImplementation(scenarioUrl);

            if (!response.ok) {
                throw new Error(`Scenario discovery request failed (${response.status}).`);
            }

            const result: unknown = await response.json();

            if (!isSchema(deviceScenarioListSchema, result) || result.deviceId !== deviceId) {
                throw new Error('Scenario discovery returned scenarios for a different device.');
            }

            return result as DeviceScenarioList;
        },
        async runScenario(action) {
            const response = await fetchImplementation(scenarioUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });

            if (!response.ok) {
                throw new Error(`Scenario control request failed (${response.status}).`);
            }

            const result: unknown = await response.json();

            if (!isSchema(deviceScenarioResultSchema, result)) {
                throw new Error('Scenario control returned an invalid response.');
            }

            if (result.action !== action) {
                throw new Error('Scenario control returned a response for a different action.');
            }

            return result as DeviceScenarioResult;
        },
        async getDiagnostics() {
            const response = await fetchImplementation(`${baseUrl}/diagnostics`);

            if (!response.ok) {
                throw new Error(`Diagnostics request failed (${response.status}).`);
            }

            const result: unknown = await response.json();

            if (!isDurableDiagnosticsSnapshot(result)) {
                throw new Error('Diagnostics returned an invalid response.');
            }

            return result;
        },
    };
}

function getBffUrl(): string {
    return (import.meta.env.VITE_BFF_URL ?? defaultBffUrl).replace(/\/+$/u, '');
}
