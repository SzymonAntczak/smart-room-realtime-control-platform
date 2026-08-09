import type { DeviceScenarioAction as ScenarioAction } from '@smart-room/contracts/development';
import { Timer, TriangleAlert, Wifi } from 'lucide-react';
import { useEffect } from 'react';

import type { DeviceScenarioClient } from '../device-scenario-client';
import {
    ScenarioPanel,
    ScenarioPanelAction,
    ScenarioPanelActions,
    ScenarioPanelSection,
    ScenarioPanelStatus,
} from '../scenario-panel';

import { useLedScenario } from './use-led-scenario';

const labels: Record<ScenarioAction, string> = {
    pause_telemetry: 'Pause telemetry',
    resume_telemetry: 'Resume telemetry',
    replay_last_reading: 'Replay last reading',
    emit_invalid_reading: 'Emit invalid reading',
    emit_next_reading: 'Emit next reading',
    reset: 'Reset scenario',
    confirm_immediately: 'Confirm immediately',
    confirm_delayed: 'Confirm after 2 seconds',
    reject_command: 'Reject next command',
    omit_confirmation: 'Omit confirmation',
    report_after_timeout: 'Report after timeout',
    degrade_device: 'Mark device degraded',
    recover_device: 'Recover device health',
    disconnect_device: 'Mark device offline',
    reconnect_device: 'Mark device online',
};

const sections = [
    {
        title: 'Command behavior',
        actions: [
            'confirm_immediately',
            'confirm_delayed',
            'reject_command',
            'omit_confirmation',
            'report_after_timeout',
        ],
    },
    { title: 'Availability', actions: ['disconnect_device', 'reconnect_device'] },
    { title: 'Health', actions: ['degrade_device', 'recover_device'] },
] as const satisfies readonly {
    readonly title: string;
    readonly actions: readonly ScenarioAction[];
}[];

export function LedScenarioPanel({
    client,
    actions,
    isCommandActive,
    onRequestChange,
}: {
    client: DeviceScenarioClient;
    actions: readonly ScenarioAction[];
    isCommandActive: boolean;
    onRequestChange(isPending: boolean): void;
}) {
    const { activeAction, selectedScenario, message, runScenario, clearSelectedScenario } =
        useLedScenario(client, onRequestChange);
    useEffect(() => {
        if (isCommandActive) {
            clearSelectedScenario();
        }
    }, [clearSelectedScenario, isCommandActive]);

    return (
        <ScenarioPanel
            title="LED scenarios"
            description="Select how the next LED command behaves. This does not change the confirmed LED state."
        >
            <div>
                {sections.map((section) => {
                    const visibleActions = section.actions.filter((action) =>
                        actions.includes(action),
                    );

                    if (visibleActions.length === 0) {
                        return null;
                    }

                    return (
                        <ScenarioPanelSection key={section.title} title={section.title}>
                            <ScenarioPanelActions>
                                {visibleActions.map((action) => (
                                    <ScenarioPanelAction
                                        key={action}
                                        type="button"
                                        disabled={activeAction !== undefined || isCommandActive}
                                        onClick={() => void runScenario(action)}
                                    >
                                        {scenarioIcon(action)}
                                        {activeAction === action ? 'Selecting...' : labels[action]}
                                    </ScenarioPanelAction>
                                ))}
                            </ScenarioPanelActions>
                        </ScenarioPanelSection>
                    );
                })}
            </div>
            {message || selectedScenario ? (
                <ScenarioPanelStatus>
                    {message ?? `${labels[selectedScenario!]} selected for the next LED command.`}
                </ScenarioPanelStatus>
            ) : null}
        </ScenarioPanel>
    );
}

function scenarioIcon(action: ScenarioAction) {
    const iconProps = { 'aria-hidden': true, size: 16, strokeWidth: 1.75 } as const;

    if (action === 'disconnect_device' || action === 'reconnect_device') {
        return <Wifi {...iconProps} />;
    }

    if (action === 'degrade_device' || action === 'recover_device') {
        return <TriangleAlert {...iconProps} />;
    }

    return <Timer {...iconProps} />;
}
