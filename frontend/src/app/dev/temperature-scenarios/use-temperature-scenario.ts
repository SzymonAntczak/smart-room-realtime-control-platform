import { useState } from 'react';
import {
    temperatureScenarioClient,
    type TemperatureScenarioClient,
    type TemperatureScenarioAction,
} from './temperature-scenario-client';

export interface TemperatureScenarioRequestState {
    readonly activeAction: TemperatureScenarioAction | undefined;
    readonly completedAction: TemperatureScenarioAction | undefined;
    readonly errorMessage: string | undefined;
    runScenario(action: TemperatureScenarioAction): Promise<void>;
}

export function useTemperatureScenario(
    client: TemperatureScenarioClient = temperatureScenarioClient,
): TemperatureScenarioRequestState {
    const [activeAction, setActiveAction] = useState<TemperatureScenarioAction>();
    const [completedAction, setCompletedAction] = useState<TemperatureScenarioAction>();
    const [errorMessage, setErrorMessage] = useState<string>();

    async function runScenario(action: TemperatureScenarioAction): Promise<void> {
        setActiveAction(action);
        setCompletedAction(undefined);
        setErrorMessage(undefined);

        try {
            const result = await client.runScenario(action);
            setCompletedAction(result.action);
        } catch (error) {
            setErrorMessage(
                error instanceof Error ? error.message : 'Scenario control request failed.',
            );
        } finally {
            setActiveAction(undefined);
        }
    }

    return {
        activeAction,
        completedAction,
        errorMessage,
        runScenario,
    };
}
