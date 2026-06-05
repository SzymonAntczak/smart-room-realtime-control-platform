import { getStatusBadgeTone } from '../room-control/status-badge-tone';
import { StatusBadge } from '../shared/ui/StatusBadge';
import styles from './LedControl.module.css';
import type { PowerState, RoomCommandView, RoomDeviceView } from '../room-control/room-view-model';

interface LedControlProps {
    device: RoomDeviceView;
    command?: RoomCommandView;
    onPowerRequest: (power: PowerState) => void;
}

export function LedControl({ device, command, onPowerRequest }: LedControlProps) {
    const reportedPower = String(device.reportedState.power ?? 'unknown');
    const requestedPower = device.requestedState?.power
        ? String(device.requestedState.power)
        : 'none';
    const availability = getCommandAvailability(device, command);

    return (
        <section className={styles.panel} aria-labelledby="led-control-heading">
            <div className={styles.header}>
                <div>
                    <p className={styles.eyebrow}>Controllable output</p>
                    <h2 id="led-control-heading">{device.name}</h2>
                </div>
                <StatusBadge
                    label={(command?.status ?? 'idle').replace('_', ' ')}
                    tone={getStatusBadgeTone(command?.status ?? 'idle')}
                />
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
                <button
                    type="button"
                    disabled={!availability.canSend}
                    onClick={() => onPowerRequest('on')}
                >
                    Request On
                </button>
                <button
                    type="button"
                    disabled={!availability.canSend}
                    onClick={() => onPowerRequest('off')}
                >
                    Request Off
                </button>
            </div>

            <div className={styles.commandStatus} aria-label="Command status">
                {command ? (
                    <>
                        <span>{command.commandId}</span>
                        <strong>
                            {command.message ??
                                'Command is being tracked by the backend projection.'}
                        </strong>
                    </>
                ) : (
                    <strong>No active command for this device.</strong>
                )}
            </div>

            {availability.message ? (
                <p className={styles.availability} data-policy={availability.policy}>
                    {availability.message}
                </p>
            ) : null}
        </section>
    );
}

function getCommandAvailability(device: RoomDeviceView, command?: RoomCommandView) {
    if (command?.status === 'pending' || command?.status === 'submitting') {
        return {
            canSend: false,
            policy: 'block' as const,
            message: 'Another command is already active for this device.',
        };
    }

    if (device.commandAvailability.policy === 'block') {
        return {
            canSend: false,
            policy: device.commandAvailability.policy,
            message: device.commandAvailability.reason ?? 'Commands are blocked for this device.',
        };
    }

    if (device.commandAvailability.policy === 'allow_with_warning') {
        return {
            canSend: true,
            policy: device.commandAvailability.policy,
            message:
                device.commandAvailability.reason ??
                'Command is allowed, but device state is uncertain.',
        };
    }

    return {
        canSend: true,
        policy: device.commandAvailability.policy,
        message: undefined,
    };
}
