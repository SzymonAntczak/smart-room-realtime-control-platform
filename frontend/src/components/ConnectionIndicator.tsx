import styles from "./ConnectionIndicator.module.css";
import type { ConnectionStatus } from "../types/viewModels";

interface ConnectionIndicatorProps {
  status: ConnectionStatus;
}

const labels: Record<ConnectionStatus, string> = {
  mock: "Mock data",
  connecting: "Connecting",
  connected: "Connected",
  disconnected: "Disconnected",
};

export function ConnectionIndicator({ status }: ConnectionIndicatorProps) {
  return (
    <div className={`${styles.indicator} ${styles[status]}`} aria-label="Connection status">
      <span className={styles.dot} aria-hidden="true" />
      <span>{labels[status]}</span>
    </div>
  );
}
