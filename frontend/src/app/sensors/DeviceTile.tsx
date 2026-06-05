import { getStatusBadgeTone } from '../room-control/status-badge-tone';
import { formatTime } from '../shared/formatting/format-time';
import { StatusBadge } from '../shared/ui/StatusBadge';
import styles from './DeviceTile.module.css';
import type { RoomDeviceView } from '../room-control/room-view-model';

interface DeviceTileProps {
    device: RoomDeviceView;
}

export function DeviceTile({ device }: DeviceTileProps) {
    return (
        <article className={styles.tile}>
            <header className={styles.header}>
                <div>
                    <h3>{device.name}</h3>
                    <p>{device.deviceId}</p>
                </div>
                <StatusBadge label={device.health} tone={getStatusBadgeTone(device.health)} />
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
            {device.commandAvailability.policy !== 'allow' ? (
                <p className={styles.commandPolicy}>{formatCommandPolicy(device)}</p>
            ) : null}
            <p className={styles.lastSeen}>
                Last seen {device.lastSeenAt ? formatTime(device.lastSeenAt) : 'never'}
            </p>
        </article>
    );
}

function formatKey(value: string) {
    return value.replace(/([A-Z])/g, ' $1').toLowerCase();
}

function formatState(state: RoomDeviceView['reportedState']) {
    return Object.entries(state)
        .map(([key, value]) => `${formatKey(key)}=${String(value)}`)
        .join(', ');
}

function formatCommandPolicy(device: RoomDeviceView) {
    const policy = device.commandAvailability.policy.replace('_', ' ');
    return device.commandAvailability.reason
        ? `Commands: ${policy}. ${device.commandAvailability.reason}`
        : `Commands: ${policy}.`;
}
