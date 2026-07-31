export const temperatureScenarioActions = [
    'pause_telemetry',
    'resume_telemetry',
    'replay_last_reading',
    'emit_invalid_reading',
    'emit_next_reading',
    'reset',
] as const;

export type TemperatureScenarioAction = (typeof temperatureScenarioActions)[number];

export interface TemperatureScenarioResult {
    readonly action: TemperatureScenarioAction;
    readonly status: 'completed';
}

export function isTemperatureScenarioAction(value: unknown): value is TemperatureScenarioAction {
    return (
        typeof value === 'string' &&
        temperatureScenarioActions.some((scenarioAction) => scenarioAction === value)
    );
}
