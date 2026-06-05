import styles from "./StatusBadge.module.css";
import type { CommandStatus, DeviceHealth } from "../types/viewModels";

interface StatusBadgeProps {
  status: DeviceHealth | CommandStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`${styles.badge} ${styles[status]}`}>{status.replace("_", " ")}</span>;
}
