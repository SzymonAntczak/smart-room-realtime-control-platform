import type { DeviceProjection } from '@smart-room/contracts/projections';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { CircleCheck, Thermometer, WifiOff } from 'lucide-react';
import { memo } from 'react';

import { TemperatureScenarioDrawer } from '../../dev/temperature-scenarios/TemperatureScenarioDrawer';
import { Alert, type AlertVariant } from '../../shared/ui/Alert';
import { ControlCard } from '../../shared/ui/ControlCard';

import { type TemperatureSensorReading, toTemperatureSensorReading } from './temperature-reading';
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

export function TemperatureControlFromRoom({
    snapshot,
    connectionStatus = 'connecting',
    contractError,
    showDevScenarioPanel = import.meta.env.DEV,
}: {
    snapshot?: RoomSnapshotProjection;
    connectionStatus?: 'connecting' | 'connected' | 'reconnecting';
    contractError?: string;
    showDevScenarioPanel?: boolean;
}) {
    const devices =
        snapshot?.devices.filter((device) => device.role === 'temperature-sensor') ?? [];
    const readyConnectionStatus =
        connectionStatus === 'connecting' ? 'reconnecting' : connectionStatus;
    const initialConnectionStatus =
        connectionStatus === 'connected' ? 'connecting' : connectionStatus;
    return (
        <TemperatureControlView
            state={
                snapshot
                    ? devices.length === 0
                        ? {
                              status: 'empty',
                              connectionStatus: readyConnectionStatus,
                              contractError,
                          }
                        : {
                              status: 'ready',
                              devices,
                              connectionStatus: readyConnectionStatus,
                              contractError,
                          }
                    : {
                          status: 'connecting',
                          connectionStatus: initialConnectionStatus,
                          contractError,
                      }
            }
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
                title="Desk Temperature"
                status={
                    controlState.connectionStatus === 'reconnecting' ? 'Reconnecting' : 'Connecting'
                }
                statusTone={
                    controlState.connectionStatus === 'reconnecting' ? 'warning' : 'neutral'
                }
                titleId="sensor-heading"
                bottomAlert={
                    controlState.contractError ? (
                        <Alert message={controlState.contractError} variant="error" />
                    ) : undefined
                }
                headerAction={
                    showDevScenarioPanel ? (
                        <TemperatureScenarioDrawer deviceId="temp-desk" />
                    ) : undefined
                }
            >
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
                title="Desk Temperature"
                status="No reading"
                statusTone="warning"
                titleId="sensor-heading"
                bottomAlert={
                    controlState.contractError ? (
                        <Alert message={controlState.contractError} variant="error" />
                    ) : undefined
                }
                headerAction={
                    showDevScenarioPanel ? (
                        <TemperatureScenarioDrawer deviceId="temp-desk" />
                    ) : undefined
                }
            >
                {controlState.connectionStatus === 'reconnecting' ? (
                    <p className={styles.warning} role="alert">
                        Realtime stream is reconnecting. Waiting for the room baseline.
                    </p>
                ) : null}
                <p className={styles.message}>No temperature reading is available yet.</p>
            </ControlCard>
        );
    }

    return (
        <>
            {controlState.contractError ? (
                <ContractErrorAlert message={controlState.contractError} />
            ) : null}
            {controlState.connectionStatus === 'reconnecting' ? (
                <p className={styles.warning} role="alert">
                    Realtime stream is reconnecting. Showing the last valid temperature update.
                </p>
            ) : null}
            <div className={styles.cards}>
                {controlState.devices.map((device) => (
                    <TemperatureCard
                        key={device.deviceId}
                        device={device}
                        showDevScenarioPanel={showDevScenarioPanel}
                    />
                ))}
            </div>
        </>
    );
}

const TemperatureCard = memo(function TemperatureCard({
    device,
    showDevScenarioPanel,
}: {
    device: DeviceProjection;
    showDevScenarioPanel?: boolean;
}) {
    const reading = toTemperatureSensorReading(device);

    return (
        <ControlCard
            title={reading.sensorName}
            status={formatAvailability(reading.availability)}
            statusIcon={getAvailabilityIcon(reading.availability)}
            statusTone={toAvailabilityTone(reading.availability)}
            titleId={`sensor-heading-${reading.sensorId}`}
            headerAction={
                showDevScenarioPanel ? (
                    <TemperatureScenarioDrawer
                        deviceId={reading.sensorId}
                        telemetryUnavailable={reading.availability === 'offline'}
                    />
                ) : undefined
            }
            bottomAlert={<Alert {...getCardAlert(reading)} />}
        >
            <div className={styles.reading} aria-label="Current temperature">
                <Thermometer
                    aria-hidden="true"
                    className={styles.readingIcon}
                    size={24}
                    strokeWidth={1.75}
                />
                <span className={styles.value}>{reading.value?.toFixed(1) ?? '—'}</span>
                <span className={styles.unit}>{reading.unit ?? ''}</span>
            </div>
        </ControlCard>
    );
});

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

function formatAvailability(availability: TemperatureSensorReading['availability']): string {
    if (availability === 'online') {
        return 'Online';
    }

    if (availability === 'offline') {
        return 'Offline';
    }

    return 'Unknown';
}

function toAvailabilityTone(availability: TemperatureSensorReading['availability']) {
    if (availability === 'online') {
        return 'success';
    }

    if (availability === 'offline') {
        return 'danger';
    }

    return 'warning';
}

function getAvailabilityIcon(availability: TemperatureSensorReading['availability']) {
    const iconProps = { 'aria-hidden': true, size: 16, strokeWidth: 1.75 } as const;

    if (availability === 'online') {
        return <CircleCheck {...iconProps} />;
    }

    if (availability === 'offline') {
        return <WifiOff {...iconProps} />;
    }

    return undefined;
}

function getCardAlert(reading: TemperatureSensorReading): {
    message?: string;
    variant?: AlertVariant;
} {
    const messages = [
        reading.availability === 'offline'
            ? `Temperature sensor is offline${reading.availabilityReason ? `: ${reading.availabilityReason}` : '.'}`
            : undefined,
        reading.health === 'degraded'
            ? (reading.healthReason ?? 'Temperature sensor health is degraded.')
            : undefined,
        reading.freshness === 'stale' && reading.recordedAt
            ? `Temperature telemetry is stale. Showing the last known reading from ${formatReadingTime(reading.recordedAt)}.`
            : undefined,
    ].filter((message): message is string => message !== undefined);
    if (messages.length > 0) return { message: messages.join(' '), variant: 'warning' };
    if (reading.recordedAt)
        return {
            message: `Last reading ${formatReadingTime(reading.recordedAt)}.`,
            variant: 'info',
        };
    return { message: 'No reading received yet.', variant: 'info' };
}
