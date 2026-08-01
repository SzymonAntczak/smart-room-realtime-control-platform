import { ControlCard } from '../../shared/ui/ControlCard';

import {
    type TemperatureEventFeedItem,
    type TemperatureSensorReading,
} from './room-realtime-client';
import styles from './TemperatureControl.module.css';
import { type TemperatureControlState, useTemperatureRealtime } from './use-temperature-realtime';

export function TemperatureControl() {
    return <TemperatureControlView state={useTemperatureRealtime()} />;
}

export function TemperatureControlView({
    state: controlState,
}: {
    state: TemperatureControlState;
}) {
    if (controlState.status === 'connecting') {
        return (
            <ControlCard
                eyebrow="Realtime room stream"
                title="Desk Temperature"
                status={
                    controlState.connectionStatus === 'reconnecting' ? 'Reconnecting' : 'Connecting'
                }
                statusTone={
                    controlState.connectionStatus === 'reconnecting' ? 'warning' : 'neutral'
                }
                titleId="sensor-heading"
            >
                {controlState.contractError ? (
                    <ContractErrorAlert message={controlState.contractError} />
                ) : null}
                <p className={styles.message}>
                    {controlState.connectionStatus === 'reconnecting'
                        ? 'Reconnecting to realtime room stream...'
                        : 'Connecting to realtime room stream...'}
                </p>
            </ControlCard>
        );
    }

    if (controlState.status === 'empty') {
        return (
            <ControlCard
                eyebrow="Realtime room stream"
                title="Desk Temperature"
                status="No reading"
                statusTone="warning"
                titleId="sensor-heading"
            >
                {controlState.contractError ? (
                    <ContractErrorAlert message={controlState.contractError} />
                ) : null}
                {controlState.connectionStatus === 'reconnecting' ? (
                    <p className={styles.warning} role="alert">
                        Realtime stream is reconnecting. Waiting for the first room snapshot.
                    </p>
                ) : null}
                <p className={styles.message}>No temperature reading is available yet.</p>
            </ControlCard>
        );
    }

    const { reading } = controlState;

    return (
        <ControlCard
            eyebrow="Realtime room stream"
            title={reading.sensorName}
            status={formatHealth(reading.health)}
            statusTone={toHealthTone(reading.health)}
            titleId="sensor-heading"
        >
            {controlState.contractError ? (
                <ContractErrorAlert message={controlState.contractError} />
            ) : null}
            {controlState.connectionStatus === 'reconnecting' ? (
                <p className={styles.warning} role="alert">
                    Realtime stream is reconnecting. Showing the last temperature snapshot.
                </p>
            ) : null}
            {getHealthWarning(reading) ? (
                <p className={styles.warning} role="alert">
                    {getHealthWarning(reading)}
                </p>
            ) : null}
            <div className={styles.reading} aria-label="Current temperature">
                <span className={styles.value}>{reading.value.toFixed(1)}</span>
                <span className={styles.unit}>{reading.unit}</span>
            </div>

            <p className={styles.updated}>
                Last reading{' '}
                <time dateTime={reading.recordedAt}>{formatReadingTime(reading.recordedAt)}</time>
                {' - '}
                {formatReadingAge(reading.recordedAt, reading.snapshotSentAt)}
            </p>

            <TemperatureEventFeed events={reading.recentEvents} />
        </ControlCard>
    );
}

function ContractErrorAlert({ message }: { message: string }) {
    return (
        <p className={styles.warning} role="alert">
            {message}
        </p>
    );
}

function formatReadingTime(recordedAt: string): string {
    return `${recordedAt.slice(11, 19)} UTC`;
}

function formatHealth(health: TemperatureSensorReading['health']): string {
    if (health === 'online') {
        return 'Online';
    }

    if (health === 'stale') {
        return 'Stale';
    }

    if (health === 'offline') {
        return 'Offline';
    }

    return 'Degraded';
}

function toHealthTone(health: TemperatureSensorReading['health']) {
    if (health === 'online') {
        return 'success';
    }

    if (health === 'offline') {
        return 'danger';
    }

    return 'warning';
}

function getHealthWarning(reading: TemperatureSensorReading): string | undefined {
    const age = formatReadingAge(reading.recordedAt, reading.snapshotSentAt);

    if (reading.health === 'stale') {
        return `Temperature telemetry is stale. Showing the last known reading from ${formatReadingTime(reading.recordedAt)} (${age}).`;
    }

    if (reading.health === 'offline') {
        return `Temperature sensor is offline. Showing the last known reading from ${formatReadingTime(reading.recordedAt)} (${age}).`;
    }

    if (reading.health === 'degraded') {
        return `Temperature sensor is degraded. Showing the latest reported reading from ${formatReadingTime(reading.recordedAt)} (${age}).`;
    }

    return undefined;
}

function formatReadingAge(recordedAt: string, observedAt: string): string {
    const ageMs = Math.max(0, Date.parse(observedAt) - Date.parse(recordedAt));
    const ageSeconds = Math.floor(ageMs / 1000);

    if (!Number.isFinite(ageSeconds)) {
        return 'age unavailable';
    }

    if (ageSeconds < 60) {
        return `${ageSeconds}s old`;
    }

    const ageMinutes = Math.floor(ageSeconds / 60);

    if (ageMinutes < 60) {
        return `${ageMinutes}m old`;
    }

    return `${Math.floor(ageMinutes / 60)}h old`;
}

function TemperatureEventFeed({ events }: { events: TemperatureEventFeedItem[] }) {
    if (events.length === 0) {
        return null;
    }

    return (
        <section className={styles.eventFeed} aria-label="Recent temperature events">
            <h2>Recent events</h2>
            <ol>
                {events.map((event) => (
                    <li key={event.eventId}>
                        <span>{event.summary}</span>
                        <time dateTime={event.occurredAt}>
                            {formatReadingTime(event.occurredAt)}
                        </time>
                    </li>
                ))}
            </ol>
        </section>
    );
}
