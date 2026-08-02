import { CircleCheck, Clock3, Thermometer, TriangleAlert, WifiOff } from 'lucide-react';

import { TemperatureScenarioDrawer } from '../../dev/temperature-scenarios/TemperatureScenarioDrawer';
import { ControlCard } from '../../shared/ui/ControlCard';

import { type TemperatureSensorReading } from './room-realtime-client';
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
                headerAction={
                    showDevScenarioPanel ? (
                        <TemperatureScenarioDrawer deviceId="temp-desk" />
                    ) : undefined
                }
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
                headerAction={
                    showDevScenarioPanel ? (
                        <TemperatureScenarioDrawer deviceId="temp-desk" />
                    ) : undefined
                }
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
            </p>
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
    if (reading.health === 'stale') {
        return `Temperature telemetry is stale. Showing the last known reading from ${formatReadingTime(reading.recordedAt)}.`;
    }

    if (reading.health === 'offline') {
        return `Temperature sensor is offline. Showing the last known reading from ${formatReadingTime(reading.recordedAt)}.`;
    }

    if (reading.health === 'degraded') {
        return `Temperature sensor is degraded. Showing the latest reported reading from ${formatReadingTime(reading.recordedAt)}.`;
    }

    return undefined;
}
