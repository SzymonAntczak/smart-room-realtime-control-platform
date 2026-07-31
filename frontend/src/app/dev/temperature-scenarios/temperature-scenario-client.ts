import {
    isTemperatureScenarioAction,
    type TemperatureScenarioResult,
} from '../../../../../shared/src/dev-scenarios';
import type { TemperatureScenarioAction } from '../../../../../shared/src/dev-scenarios';

export type { TemperatureScenarioAction } from '../../../../../shared/src/dev-scenarios';

const defaultScenarioControlUrl = 'http://localhost:4310/dev/scenarios/temperature';

export interface TemperatureScenarioClient {
    runScenario(action: TemperatureScenarioAction): Promise<TemperatureScenarioResult>;
}

export function createTemperatureScenarioClient(
    fetchImplementation: typeof fetch = fetch,
    scenarioControlUrl = getScenarioControlUrl(),
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
    };
}

export const temperatureScenarioClient = createTemperatureScenarioClient();

function getScenarioControlUrl(): string {
    return import.meta.env.VITE_TEMPERATURE_SCENARIO_CONTROL_URL ?? defaultScenarioControlUrl;
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
