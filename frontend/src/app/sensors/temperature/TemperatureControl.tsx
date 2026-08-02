import { CircleCheck, Clock3, Thermometer, TriangleAlert, WifiOff } from 'lucide-react';

import { TemperatureScenarioDrawer } from '../../dev/temperature-scenarios/TemperatureScenarioDrawer';
import { ControlCard } from '../../shared/ui/ControlCard';

import {
    type TemperatureEventFeedItem,
    type TemperatureSensorReading,
} from './room-realtime-client';
import styles from './TemperatureControl.module.css';
import { type TemperatureControlState, useTemperatureRealtime } from './use-temperature-realtime';

export function TemperatureControl({
    showDevScenarioPanel = import.meta.env.DEV,
}: {
    showDevScenarioPanel?: boolean;
}) {
    return (
        <TemperatureControlView
            state={useTemperatureRealtime()}
            showDevScenarioPanel={showDevScenarioPanel}
        />
    );
}

export function TemperatureControlView({
    state: controlState,
    showDevScenarioPanel,
}: {
    state: TemperatureControlState;
    showDevScenarioPanel?: boolean;
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
                        Realtime stream is reconnecting. Waiting for the room baseline.
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
            statusIcon={getHealthIcon(reading.health)}
            statusTone={toHealthTone(reading.health)}
            titleId="sensor-heading"
            headerAction={
                showDevScenarioPanel ? (
                    <TemperatureScenarioDrawer deviceId={reading.sensorId} />
                ) : undefined
            }
        >
            {controlState.contractError ? (
                <ContractErrorAlert message={controlState.contractError} />
            ) : null}
            {controlState.connectionStatus === 'reconnecting' ? (
                <p className={styles.warning} role="alert">
                    Realtime stream is reconnecting. Showing the last valid temperature update.
                </p>
            ) : null}
            {getHealthWarning(reading) ? (
                <p className={styles.warning} role="alert">
                    {getHealthWarning(reading)}
                </p>
            ) : null}
            <div className={styles.reading} aria-label="Current temperature">
                <Thermometer
                    aria-hidden="true"
                    className={styles.readingIcon}
                    size={24}
                    strokeWidth={1.75}
                />
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

function getHealthIcon(health: TemperatureSensorReading['health']) {
    const iconProps = { 'aria-hidden': true, size: 16, strokeWidth: 1.75 } as const;

    if (health === 'online') {
        return <CircleCheck {...iconProps} />;
    }

    if (health === 'stale') {
        return <Clock3 {...iconProps} />;
    }

    if (health === 'offline') {
        return <WifiOff {...iconProps} />;
    }

    return <TriangleAlert {...iconProps} />;
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
