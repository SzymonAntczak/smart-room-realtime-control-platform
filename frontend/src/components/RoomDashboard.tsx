import { ConnectionIndicator } from "./ConnectionIndicator";
import { DeviceTile } from "./DeviceTile";
import { EventFeed } from "./EventFeed";
import { LedControl } from "./LedControl";
import styles from "./RoomDashboard.module.css";
import type { PowerState, RoomSnapshotView } from "../types/viewModels";

interface RoomDashboardProps {
  snapshot: RoomSnapshotView;
  onLedPowerRequest: (power: PowerState) => void;
}

export function RoomDashboard({ snapshot, onLedPowerRequest }: RoomDashboardProps) {
  const ledDevice = snapshot.devices.find((device) => device.role === "led-output");
  const activeLedCommand = snapshot.activeCommands.find(
    (command) => command.deviceId === ledDevice?.deviceId,
  );

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Stage 1 local frontend</p>
          <h1>{snapshot.roomName}</h1>
          <p className={styles.updated}>Last projection update {formatDate(snapshot.updatedAt)}</p>
        </div>
        <ConnectionIndicator status={snapshot.connectionStatus} />
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
