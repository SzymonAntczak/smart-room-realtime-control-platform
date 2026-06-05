import { StatusBadge } from "./StatusBadge";
import styles from "./DeviceTile.module.css";
import type { DeviceView } from "../types/viewModels";

interface DeviceTileProps {
  device: DeviceView;
}

export function DeviceTile({ device }: DeviceTileProps) {
  return (
    <article className={styles.tile}>
      <header className={styles.header}>
        <div>
          <h3>{device.name}</h3>
          <p>{device.deviceId}</p>
        </div>
        <StatusBadge status={device.health} />
      </header>

      <dl className={styles.stateList}>
        {Object.entries(device.reportedState).map(([key, value]) => (
          <div key={key}>
            <dt>{formatKey(key)}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>

      {device.requestedState ? (
        <div className={styles.requested} aria-label={`${device.name} requested state`}>
          Requested {formatState(device.requestedState)}
        </div>
      ) : null}

      {device.warning ? <p className={styles.warning}>{device.warning}</p> : null}
      <p className={styles.lastSeen}>Last seen {device.lastSeenAt ? formatDate(device.lastSeenAt) : "never"}</p>
    </article>
  );
}

function formatKey(value: string) {
  return value.replace(/([A-Z])/g, " $1").toLowerCase();
}

function formatState(state: DeviceView["reportedState"]) {
  return Object.entries(state)
    .map(([key, value]) => `${formatKey(key)}=${String(value)}`)
    .join(", ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
