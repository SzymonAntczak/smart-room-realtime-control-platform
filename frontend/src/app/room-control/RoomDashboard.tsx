import { EventFeed } from '../event-feed/EventFeed';
import { LedControl } from '../led-control/LedControl';
import { DeviceTile } from '../sensors/DeviceTile';
import { formatTime } from '../shared/formatting/format-time';
import { ConnectionIndicator } from '../shared/ui/ConnectionIndicator';
import { getConnectionIndicatorView } from './connection-indicator-view';
import styles from './RoomDashboard.module.css';
import type { PowerState, RoomSnapshotView } from './room-view-model';

interface RoomDashboardProps {
    snapshot: RoomSnapshotView;
    onLedPowerRequest: (power: PowerState) => void;
}

export function RoomDashboard({ snapshot, onLedPowerRequest }: RoomDashboardProps) {
    const ledDevice = snapshot.devices.find((device) => device.role === 'led-output');
    const activeLedCommand = snapshot.activeCommands.find(
        (command) => command.deviceId === ledDevice?.deviceId,
    );
    const connectionIndicator = getConnectionIndicatorView(snapshot.connectionStatus);

    return (
        <main className={styles.shell}>
            <header className={styles.header}>
                <div>
                    <p className={styles.eyebrow}>Stage 1 local frontend</p>
                    <h1>{snapshot.roomName}</h1>
                    <p className={styles.updated}>
                        Last projection update {formatTime(snapshot.updatedAt)}
                    </p>
                </div>
                <ConnectionIndicator
                    label={connectionIndicator.label}
                    tone={connectionIndicator.tone}
                />
            </header>

            <section className={styles.grid} aria-label="Room state">
                <div className={styles.primary}>
                    {ledDevice ? (
                        <LedControl
                            device={ledDevice}
                            command={activeLedCommand}
                            onPowerRequest={onLedPowerRequest}
                        />
                    ) : null}

                    <section className={styles.devices} aria-labelledby="devices-heading">
                        <h2 id="devices-heading">Devices</h2>
                        <div className={styles.deviceGrid}>
                            {snapshot.devices.map((device) => (
                                <DeviceTile key={device.deviceId} device={device} />
                            ))}
                        </div>
                    </section>
                </div>

                <aside className={styles.side} aria-label="Recent platform events">
                    <EventFeed events={snapshot.recentEvents} />
                </aside>
            </section>
        </main>
    );
}
