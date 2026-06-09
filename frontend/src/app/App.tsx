import styles from './App.module.css';
import { TemperatureControl } from './sensors/temperature/TemperatureControl';

export function App() {
    return (
        <main className={styles.shell}>
            <TemperatureControl />
        </main>
    );
}
