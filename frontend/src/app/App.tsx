import styles from './App.module.css';
import { LedControl } from './controls/led/LedControl';
import { useRoomRealtime } from './room/realtime/use-room-realtime';
import { TemperatureControlFromRoom } from './sensors/temperature/TemperatureControl';

interface AppProps {
    readonly showDevScenarioPanel?: boolean;
}

export function App({ showDevScenarioPanel = import.meta.env.DEV }: AppProps) {
    const room = useRoomRealtime();
    const led =
        room.status === 'ready'
            ? room.snapshot.devices.find((device) => device.role === 'led-output')
            : undefined;
    const activeLedCommand =
        led && room.status === 'ready'
            ? room.snapshot.activeCommands.find((command) => command.deviceId === led.deviceId)
            : undefined;
    const recentLedCommand =
        led && room.status === 'ready'
            ? room.snapshot.recentCommands.find((command) => command.deviceId === led.deviceId)
            : undefined;
    const realtimeUncertain =
        room.connectionStatus === 'reconnecting' || room.contractError !== undefined;

    return (
        <main className={styles.shell}>
            <div className={styles.controls}>
                <TemperatureControlFromRoom
                    snapshot={room.status === 'ready' ? room.snapshot : undefined}
                    connectionStatus={room.connectionStatus}
                    contractError={room.contractError}
                    showDevScenarioPanel={showDevScenarioPanel}
                />
                <LedControl
                    device={led}
                    activeCommand={activeLedCommand}
                    recentCommand={recentLedCommand}
                    showDevScenarioPanel={showDevScenarioPanel}
                    realtimeUncertain={realtimeUncertain}
                />
            </div>
        </main>
    );
}
