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
    const { activeAction, completedAction, errorMessage, runScenario } =
        useTemperatureScenario(client);
    const message = errorMessage ?? toCompletedMessage(completedAction);

    return (
        <aside className={styles.panel} aria-labelledby="scenario-panel-heading">
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
        </aside>
    );
}

function toCompletedMessage(action: TemperatureScenarioAction | undefined): string | undefined {
    if (!action) {
        return undefined;
    }

    const control = controls.find((candidate) => candidate.action === action);

    return control ? `${control.label} completed.` : undefined;
}
