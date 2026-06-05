import { StatusBadge } from "./StatusBadge";
import styles from "./LedControl.module.css";
import type { CommandView, DeviceView, PowerState } from "../types/viewModels";

interface LedControlProps {
  device: DeviceView;
  command?: CommandView;
  onPowerRequest: (power: PowerState) => void;
}

export function LedControl({ device, command, onPowerRequest }: LedControlProps) {
  const reportedPower = String(device.reportedState.power ?? "unknown");
  const requestedPower = device.requestedState?.power
    ? String(device.requestedState.power)
    : "none";

  return (
    <section className={styles.panel} aria-labelledby="led-control-heading">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Controllable output</p>
          <h2 id="led-control-heading">{device.name}</h2>
        </div>
        <StatusBadge status={command?.status ?? "idle"} />
      </div>

      <div className={styles.states}>
        <div className={styles.stateBox}>
          <span>Reported power</span>
          <strong>{reportedPower}</strong>
        </div>
        <div className={styles.stateBox}>
          <span>Requested power</span>
          <strong>{requestedPower}</strong>
        </div>
      </div>

      <div className={styles.actions} aria-label="LED power controls">
        <button type="button" onClick={() => onPowerRequest("on")}>
          Request On
        </button>
        <button type="button" onClick={() => onPowerRequest("off")}>
          Request Off
        </button>
      </div>

      <div className={styles.commandStatus} aria-label="Command status">
        {command ? (
          <>
            <span>{command.commandId}</span>
            <strong>{command.message ?? "Command is being tracked by the backend projection."}</strong>
          </>
        ) : (
          <strong>No active command for this device.</strong>
        )}
      </div>
    </section>
  );
}
