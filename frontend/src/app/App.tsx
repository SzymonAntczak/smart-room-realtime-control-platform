import styles from './App.module.css';
import { TemperatureScenarioPanel } from './dev/temperature-scenarios/TemperatureScenarioPanel';
import { TemperatureControl } from './sensors/temperature/TemperatureControl';

interface AppProps {
    readonly showDevScenarioPanel?: boolean;
}

export function App({ showDevScenarioPanel = import.meta.env.DEV }: AppProps) {
    return (
        <main className={styles.shell}>
            <TemperatureControl />
            {showDevScenarioPanel ? <TemperatureScenarioPanel /> : null}
        </main>
    );
}
