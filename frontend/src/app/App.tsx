import styles from './App.module.css';
import { TemperatureControl } from './sensors/temperature/TemperatureControl';

interface AppProps {
    readonly showDevScenarioPanel?: boolean;
}

export function App({ showDevScenarioPanel = import.meta.env.DEV }: AppProps) {
    return (
        <main className={styles.shell}>
            <h1>Smart Room</h1>
            <TemperatureControl showDevScenarioPanel={showDevScenarioPanel} />
        </main>
    );
}
