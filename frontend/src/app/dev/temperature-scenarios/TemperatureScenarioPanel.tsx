import styles from './TemperatureScenarioPanel.module.css';
import type {
    TemperatureScenarioAction,
    TemperatureScenarioClient,
} from './temperature-scenario-client';
import { useTemperatureScenario } from './use-temperature-scenario';

interface ScenarioControl {
    readonly action: TemperatureScenarioAction;
    readonly label: string;
}

const controls: readonly ScenarioControl[] = [
    { action: 'pause_telemetry', label: 'Pause telemetry' },
    { action: 'resume_telemetry', label: 'Resume telemetry' },
    { action: 'emit_next_reading', label: 'Emit next reading' },
    { action: 'replay_last_reading', label: 'Replay last reading' },
    { action: 'emit_invalid_reading', label: 'Emit invalid reading' },
    { action: 'reset', label: 'Reset scenario' },
];

interface TemperatureScenarioPanelProps {
    readonly client?: TemperatureScenarioClient;
}

export function TemperatureScenarioPanel({ client }: TemperatureScenarioPanelProps) {
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
    const message = errorMessage ?? toCompletedMessage(completedAction);

    return (
        <section className={styles.panel} aria-labelledby="scenario-panel-heading">
            <p className={styles.eyebrow}>Development only</p>
            <h2 id="scenario-panel-heading">Temperature scenarios</h2>
            <p className={styles.description}>
                Controls operate the local simulator through the backend. Room state still arrives
                through the realtime snapshot.
            </p>
            <div className={styles.controls}>
                {controls.map((control) => (
                    <button
                        key={control.action}
                        className={styles.button}
                        type="button"
                        disabled={activeAction !== undefined}
                        onClick={() => void runScenario(control.action)}
                    >
                        {activeAction === control.action ? 'Running...' : control.label}
                    </button>
                ))}
            </div>
            {message ? (
                <p className={styles.message} role="status">
                    {message}
                </p>
            ) : null}
            <section className={styles.diagnostics} aria-labelledby="diagnostics-heading">
                <div className={styles.diagnosticsHeader}>
                    <div>
                        <h3 id="diagnostics-heading">Diagnostics</h3>
                        <p>Ignored events: {diagnostics?.ignoredEvents.length ?? 'not loaded'}</p>
                    </div>
                    <button
                        className={styles.button}
                        type="button"
                        disabled={isRefreshingDiagnostics || activeAction !== undefined}
                        onClick={() => void refreshDiagnostics()}
                    >
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
