import {
    History,
    type LucideIcon,
    Pause,
    Play,
    RefreshCw,
    RotateCcw,
    StepForward,
    TriangleAlert,
} from 'lucide-react';
import { useEffect, useId } from 'react';

import type {
    TemperatureScenarioAction,
    TemperatureScenarioClient,
} from './temperature-scenario-client';
import styles from './TemperatureScenarioPanel.module.css';
import { useTemperatureScenario } from './use-temperature-scenario';

interface ScenarioControl {
    readonly action: TemperatureScenarioAction;
    readonly label: string;
    readonly Icon: LucideIcon;
}

const controls: readonly ScenarioControl[] = [
    { action: 'pause_telemetry', label: 'Pause telemetry', Icon: Pause },
    { action: 'resume_telemetry', label: 'Resume telemetry', Icon: Play },
    { action: 'emit_next_reading', label: 'Emit next reading', Icon: StepForward },
    { action: 'replay_last_reading', label: 'Replay last reading', Icon: History },
    { action: 'emit_invalid_reading', label: 'Emit invalid reading', Icon: TriangleAlert },
    { action: 'reset', label: 'Reset scenario', Icon: RotateCcw },
];

interface TemperatureScenarioPanelProps {
    readonly client?: TemperatureScenarioClient;
    readonly actions?: readonly TemperatureScenarioAction[];
    readonly completedAction?: TemperatureScenarioAction;
    readonly onCompletedAction?: (action: TemperatureScenarioAction) => void;
}

export function TemperatureScenarioPanel({
    client,
    actions,
    completedAction: persistedCompletedAction,
    onCompletedAction,
}: TemperatureScenarioPanelProps) {
    const reactId = useId().replace(/:/g, '');
    const headingId = `scenario-panel-heading-${reactId}`;
    const diagnosticsHeadingId = `diagnostics-heading-${reactId}`;
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
        <section className={styles.panel} aria-labelledby={headingId}>
            <p className={styles.eyebrow}>Development only</p>
            <h2 id={headingId}>Temperature scenarios</h2>
            <p className={styles.description}>
                Controls operate the local simulator through the backend. Room state still arrives
                through the realtime stream: a snapshot baseline followed by device updates.
            </p>
            <div className={styles.controls}>
                {controls
                    .filter((control) => actions?.includes(control.action) ?? true)
                    .map((control) => (
                        <button
                            key={control.action}
                            className={styles.button}
                            type="button"
                            disabled={activeAction !== undefined}
                            onClick={() => void runScenario(control.action)}
                        >
                            <control.Icon aria-hidden="true" size={16} strokeWidth={1.75} />
                            {activeAction === control.action ? 'Running...' : control.label}
                        </button>
                    ))}
            </div>
            {message ? (
                <p className={styles.message} role="status">
                    {message}
                </p>
            ) : null}
            <section className={styles.diagnostics} aria-labelledby={diagnosticsHeadingId}>
                <div className={styles.diagnosticsHeader}>
                    <div>
                        <h3 id={diagnosticsHeadingId}>Diagnostics</h3>
                        <p>Ignored events: {diagnostics?.ignoredEvents.length ?? 'not loaded'}</p>
                    </div>
                    <button
                        className={styles.button}
                        type="button"
                        disabled={isRefreshingDiagnostics || activeAction !== undefined}
                        onClick={() => void refreshDiagnostics()}
                    >
                        <RefreshCw aria-hidden="true" size={16} strokeWidth={1.75} />
                        {isRefreshingDiagnostics ? 'Refreshing...' : 'Refresh diagnostics'}
                    </button>
                </div>
                {diagnosticsErrorMessage ? (
                    <p className={styles.message} role="alert">
                        {diagnosticsErrorMessage}
                    </p>
                ) : null}
                {diagnostics ? <DiagnosticsList diagnostics={diagnostics} /> : null}
            </section>
        </section>
    );
}

function DiagnosticsList({
    diagnostics,
}: {
    diagnostics: NonNullable<ReturnType<typeof useTemperatureScenario>['diagnostics']>;
}) {
    if (diagnostics.ignoredEvents.length === 0) {
        return <p className={styles.diagnosticsEmpty}>No ignored events recorded.</p>;
    }

    return (
        <ol className={styles.diagnosticsList}>
            {diagnostics.ignoredEvents.map((event) => (
                <li key={event.diagnosticId}>
                    <strong>{event.reason}</strong>
                    <span>{event.eventType ?? 'unknown event'}</span>
                    <span>{event.deviceId ?? 'no device'}</span>
                    <time dateTime={event.observedAt}>
                        {formatDiagnosticTime(event.observedAt)}
                    </time>
                </li>
            ))}
        </ol>
    );
}

function formatDiagnosticTime(timestamp: string): string {
    return `${timestamp.slice(11, 19)} UTC`;
}

function toCompletedMessage(action: TemperatureScenarioAction | undefined): string | undefined {
    if (!action) {
        return undefined;
    }

    const control = controls.find((candidate) => candidate.action === action);

    return control ? `${control.label} completed.` : undefined;
}
