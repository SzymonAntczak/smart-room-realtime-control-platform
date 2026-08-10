import type {
    DeviceScenarioAction,
    EventProcessingDiagnosticsSnapshot,
} from '@smart-room/contracts/development';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceScenarioClient } from './device-scenario-client';
import type { ScenarioDefinition } from './scenario-definition';

export function useScenarioActionRequest({
    client,
    definition,
    isCommandActive,
    onRequestChange,
}: {
    client: DeviceScenarioClient | undefined;
    definition: ScenarioDefinition;
    isCommandActive: boolean;
    onRequestChange(isPending: boolean): void;
}) {
    const { t } = useTranslation('development');
    const [activeAction, setActiveAction] = useState<DeviceScenarioAction>();
    const [message, setMessage] = useState<string>();
    const [selectedAction, setSelectedAction] = useState<DeviceScenarioAction>();
    const [diagnostics, setDiagnostics] = useState<EventProcessingDiagnosticsSnapshot>();
    const [diagnosticsErrorMessage, setDiagnosticsErrorMessage] = useState<string>();
    const [isRefreshingDiagnostics, setIsRefreshingDiagnostics] = useState(false);
    const latestDiagnosticsRequest = useRef(0);

    const refreshDiagnostics = useCallback(async (): Promise<void> => {
        if (!client || !definition.diagnostics) {
            return;
        }

        const requestId = latestDiagnosticsRequest.current + 1;
        latestDiagnosticsRequest.current = requestId;
        setIsRefreshingDiagnostics(true);
        setDiagnosticsErrorMessage(undefined);

        try {
            const result = await client.getDiagnostics();

            if (requestId === latestDiagnosticsRequest.current) {
                setDiagnostics(result);
            }
        } catch {
            if (requestId === latestDiagnosticsRequest.current) {
                setDiagnosticsErrorMessage(t('diagnosticsRequestFailed'));
            }
        } finally {
            if (requestId === latestDiagnosticsRequest.current) {
                setIsRefreshingDiagnostics(false);
            }
        }
    }, [client, definition.diagnostics, t]);

    const clearSelection = useCallback(() => {
        setSelectedAction(undefined);
        setMessage(undefined);
    }, []);

    useEffect(() => {
        if (isCommandActive) {
            clearSelection();
        }
    }, [clearSelection, isCommandActive]);

    async function runScenario(action: DeviceScenarioAction): Promise<void> {
        if (!client) {
            return;
        }

        const actionDefinition = definition.sections
            .flatMap((section) => section.actions)
            .find((candidate) => candidate.action === action);

        if (!actionDefinition) {
            return;
        }

        setActiveAction(action);
        setMessage(undefined);
        onRequestChange(true);

        try {
            const result = await client.runScenario(action);

            if (actionDefinition.outcome === 'completed') {
                setMessage(t('actionCompleted', { action: t(actionDefinition.labelKey) }));
            } else if (actionDefinition.outcome === 'selected') {
                setSelectedAction(result.action);
            } else {
                setSelectedAction(undefined);
            }

            if (definition.diagnostics?.refreshAfterAction) {
                void refreshDiagnostics();
            }
        } catch {
            setMessage(t('scenarioRequestFailed'));
        } finally {
            setActiveAction(undefined);
            onRequestChange(false);
        }
    }

    const selectedActionLabel = definition.sections
        .flatMap((section) => section.actions)
        .find((candidate) => candidate.action === selectedAction)?.labelKey;

    return {
        activeAction,
        diagnostics,
        diagnosticsErrorMessage,
        isRefreshingDiagnostics,
        message:
            message ??
            (selectedActionLabel
                ? t('actionSelected', { action: t(selectedActionLabel) })
                : undefined),
        refreshDiagnostics,
        runScenario,
    };
}
