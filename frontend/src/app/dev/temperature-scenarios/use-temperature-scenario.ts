import type { EventProcessingDiagnosticsSnapshot } from '@smart-room/contracts/development';
import { useRef, useState } from 'react';

import {
    type TemperatureScenarioAction,
    type TemperatureScenarioClient,
    temperatureScenarioClient,
} from './temperature-scenario-client';

export interface TemperatureScenarioRequestState {
    readonly activeAction: TemperatureScenarioAction | undefined;
    readonly completedAction: TemperatureScenarioAction | undefined;
    readonly errorMessage: string | undefined;
    readonly diagnostics: EventProcessingDiagnosticsSnapshot | undefined;
    readonly isRefreshingDiagnostics: boolean;
    readonly diagnosticsErrorMessage: string | undefined;
    runScenario(action: TemperatureScenarioAction): Promise<void>;
    refreshDiagnostics(): Promise<void>;
}

export function useTemperatureScenario(
    client: TemperatureScenarioClient = temperatureScenarioClient,
): TemperatureScenarioRequestState {
    const [activeAction, setActiveAction] = useState<TemperatureScenarioAction>();
    const [completedAction, setCompletedAction] = useState<TemperatureScenarioAction>();
    const [errorMessage, setErrorMessage] = useState<string>();
    const [diagnostics, setDiagnostics] = useState<EventProcessingDiagnosticsSnapshot>();
    const [isRefreshingDiagnostics, setIsRefreshingDiagnostics] = useState(false);
    const [diagnosticsErrorMessage, setDiagnosticsErrorMessage] = useState<string>();
    const latestDiagnosticsRequest = useRef(0);

    async function runScenario(action: TemperatureScenarioAction): Promise<void> {
        setActiveAction(action);
        setCompletedAction(undefined);
        setErrorMessage(undefined);

        try {
            const result = await client.runScenario(action);
            setCompletedAction(result.action);
            void refreshDiagnostics();
        } catch (error) {
            setErrorMessage(
                error instanceof Error ? error.message : 'Scenario control request failed.',
            );
        } finally {
            setActiveAction(undefined);
        }
    }

    async function refreshDiagnostics(): Promise<void> {
        const requestId = latestDiagnosticsRequest.current + 1;
        latestDiagnosticsRequest.current = requestId;
        setIsRefreshingDiagnostics(true);
        setDiagnosticsErrorMessage(undefined);

        try {
            const snapshot = await client.getDiagnostics();

            if (requestId === latestDiagnosticsRequest.current) {
                setDiagnostics(snapshot);
            }
        } catch (error) {
            if (requestId === latestDiagnosticsRequest.current) {
                setDiagnosticsErrorMessage(
                    error instanceof Error ? error.message : 'Diagnostics request failed.',
                );
            }
        } finally {
            if (requestId === latestDiagnosticsRequest.current) {
                setIsRefreshingDiagnostics(false);
            }
        }
    }

    return {
        activeAction,
        completedAction,
        errorMessage,
        diagnostics,
        isRefreshingDiagnostics,
        diagnosticsErrorMessage,
        runScenario,
        refreshDiagnostics,
    };
}
