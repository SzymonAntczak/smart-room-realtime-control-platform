import {
    History,
    type LucideIcon,
    Pause,
    Play,
    RotateCcw,
    StepForward,
    TriangleAlert,
} from 'lucide-react';
import { useEffect } from 'react';

import type { DeviceScenarioClient, TemperatureScenarioAction } from '../device-scenario-client';
import { DeviceScenarioAction } from '../DeviceScenarioAction';
import { DeviceScenarioActions } from '../DeviceScenarioActions';
import { DeviceScenarioPanel } from '../DeviceScenarioPanel';
import { DeviceScenarioSection } from '../DeviceScenarioSection';
import { DeviceScenarioStatus } from '../DeviceScenarioStatus';

import { TemperatureScenarioDiagnostics } from './TemperatureScenarioDiagnostics';
import { useTemperatureScenario } from './use-temperature-scenario';

interface ScenarioControl {
    readonly action: TemperatureScenarioAction;
    readonly label: string;
    readonly Icon: LucideIcon;
}

interface ScenarioSection {
    readonly title: string;
    readonly controls: readonly ScenarioControl[];
}

const sections: readonly ScenarioSection[] = [
    {
        title: 'Freshness and telemetry',
        controls: [
            { action: 'pause_telemetry', label: 'Pause telemetry', Icon: Pause },
            { action: 'resume_telemetry', label: 'Resume telemetry', Icon: Play },
            { action: 'emit_next_reading', label: 'Emit next reading', Icon: StepForward },
            { action: 'replay_last_reading', label: 'Replay last reading', Icon: History },
            { action: 'emit_invalid_reading', label: 'Emit invalid reading', Icon: TriangleAlert },
            { action: 'reset', label: 'Reset scenario', Icon: RotateCcw },
        ],
    },
    {
        title: 'Availability',
        controls: [
            { action: 'disconnect_device', label: 'Mark device offline', Icon: Pause },
            { action: 'reconnect_device', label: 'Mark device online', Icon: Play },
        ],
    },
    {
        title: 'Health',
        controls: [
            { action: 'degrade_device', label: 'Degrade device health', Icon: TriangleAlert },
            { action: 'recover_device', label: 'Recover device health', Icon: RotateCcw },
        ],
    },
];
const controls = sections.flatMap((section) => section.controls);

interface TemperatureScenarioPanelProps {
    readonly client?: DeviceScenarioClient;
    readonly actions?: readonly TemperatureScenarioAction[];
    readonly completedAction?: TemperatureScenarioAction;
    readonly onCompletedAction?: (action: TemperatureScenarioAction) => void;
    readonly telemetryUnavailable?: boolean;
}

const telemetryActions: readonly TemperatureScenarioAction[] = [
    'pause_telemetry',
    'resume_telemetry',
    'emit_next_reading',
    'replay_last_reading',
    'emit_invalid_reading',
    'reset',
];

export function TemperatureScenarioPanel({
    client,
    actions,
    completedAction: persistedCompletedAction,
    onCompletedAction,
    telemetryUnavailable = false,
}: TemperatureScenarioPanelProps) {
    const {
        activeAction,
        completedAction,
        errorMessage,
        diagnostics,
        isRefreshingDiagnostics,
        diagnosticsErrorMessage,
        runScenario,
        refreshDiagnostics,
    } = useTemperatureScenario(client);
    useEffect(() => {
        if (completedAction) onCompletedAction?.(completedAction);
    }, [completedAction, onCompletedAction]);
    const message = errorMessage ?? toCompletedMessage(completedAction ?? persistedCompletedAction);

    return (
        <DeviceScenarioPanel
            title="Temperature scenarios"
            description="Controls operate the local simulator through the backend. Room state still arrives through the realtime stream: a snapshot baseline followed by device updates."
        >
            {telemetryUnavailable ? (
                <p>Telemetry controls are unavailable while the device is offline.</p>
            ) : null}
            <div>
                {sections.map((section) => {
                    const visibleControls = section.controls.filter(
                        (control) => actions?.includes(control.action) ?? true,
                    );
                    if (visibleControls.length === 0) return null;
                    return (
                        <DeviceScenarioSection key={section.title} title={section.title}>
                            <DeviceScenarioActions>
                                {visibleControls.map((control) => (
                                    <DeviceScenarioAction
                                        key={control.action}
                                        type="button"
                                        disabled={
                                            activeAction !== undefined ||
                                            (telemetryUnavailable &&
                                                telemetryActions.includes(control.action))
                                        }
                                        onClick={() => void runScenario(control.action)}
                                    >
                                        <control.Icon
                                            aria-hidden="true"
                                            size={16}
                                            strokeWidth={1.75}
                                        />
                                        {activeAction === control.action
                                            ? 'Running...'
                                            : control.label}
                                    </DeviceScenarioAction>
                                ))}
                            </DeviceScenarioActions>
                        </DeviceScenarioSection>
                    );
                })}
            </div>
            {message ? <DeviceScenarioStatus>{message}</DeviceScenarioStatus> : null}
            <TemperatureScenarioDiagnostics
                diagnostics={diagnostics}
                errorMessage={diagnosticsErrorMessage}
                isRefreshing={isRefreshingDiagnostics}
                isActionActive={activeAction !== undefined}
                onRefresh={() => void refreshDiagnostics()}
            />
        </DeviceScenarioPanel>
    );
}

function toCompletedMessage(action: TemperatureScenarioAction | undefined): string | undefined {
    if (!action) {
        return undefined;
    }

    const control = controls.find((candidate) => candidate.action === action);

    return control ? `${control.label} completed.` : undefined;
}
