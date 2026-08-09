import type { DeviceScenarioAction } from '@smart-room/contracts/development';
import { useCallback, useState } from 'react';

import type { DeviceScenarioClient } from '../device-scenario-client';

export function useLedScenario(
    client: DeviceScenarioClient,
    onRequestChange: (isPending: boolean) => void,
) {
    const [activeAction, setActiveAction] = useState<DeviceScenarioAction>();
    const [selectedScenario, setSelectedScenario] = useState<DeviceScenarioAction>();
    const [message, setMessage] = useState<string>();

    async function runScenario(action: DeviceScenarioAction): Promise<void> {
        setActiveAction(action);
        onRequestChange(true);
        setMessage(undefined);

        try {
            const result = await client.runScenario(action);
            setSelectedScenario(
                result.action === 'confirm_immediately' ? undefined : result.action,
            );
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Scenario control request failed.');
        } finally {
            setActiveAction(undefined);
            onRequestChange(false);
        }
    }

    const clearSelectedScenario = useCallback((): void => {
        setSelectedScenario(undefined);
        setMessage(undefined);
    }, []);

    return { activeAction, selectedScenario, message, runScenario, clearSelectedScenario };
}
