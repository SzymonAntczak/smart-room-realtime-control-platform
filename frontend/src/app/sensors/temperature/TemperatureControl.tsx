import type { DeviceProjection } from '@smart-room/contracts/projections';
import { CircleCheck, Thermometer, WifiOff } from 'lucide-react';

import type { DeviceScenarioTarget } from '../../dev/device-scenarios/device-scenario-target';
import { DeviceScenarioTrigger } from '../../dev/device-scenarios/DeviceScenarioTrigger';
import { Alert, type AlertVariant } from '../../shared/ui/Alert';
import { ControlCard } from '../../shared/ui/ControlCard';

import { toTemperatureSensorReading } from './temperature-reading';
import styles from './TemperatureControl.module.css';

export function TemperatureControl({
    device,
    showDevScenarioPanel = false,
    activeDevScenarioDeviceId,
    onOpenDevScenario,
    realtimeUncertain = false,
}: {
    device: DeviceProjection;
    showDevScenarioPanel?: boolean;
    activeDevScenarioDeviceId?: string;
    onOpenDevScenario?(target: DeviceScenarioTarget): void;
    realtimeUncertain?: boolean;
}) {
    if (device.role !== 'temperature-sensor') return null;
    const reading = toTemperatureSensorReading(device);
    return (
        <ControlCard
            title={reading.sensorName}
            titleId={`sensor-heading-${reading.sensorId}`}
            status={formatAvailability(reading.availability)}
            statusIcon={availabilityIcon(reading.availability)}
            statusTone={availabilityTone(reading.availability)}
            headerAction={
                showDevScenarioPanel ? (
                    <DeviceScenarioTrigger
                        deviceId={reading.sensorId}
                        expanded={activeDevScenarioDeviceId === reading.sensorId}
                        onClick={() =>
                            onOpenDevScenario?.({
                                kind: 'temperature',
                                deviceId: reading.sensorId,
                                telemetryUnavailable: reading.availability === 'offline',
                            })
                        }
                    />
                ) : undefined
            }
            bottomAlert={<Alert {...cardAlert(reading, realtimeUncertain)} />}
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
}

function formatAvailability(availability: 'online' | 'offline' | 'unknown') {
    return availability[0]?.toUpperCase() + availability.slice(1);
}
function availabilityTone(availability: 'online' | 'offline' | 'unknown') {
    return availability === 'online'
        ? 'success'
        : availability === 'offline'
          ? 'danger'
          : 'warning';
}
function availabilityIcon(availability: 'online' | 'offline' | 'unknown') {
    const props = { 'aria-hidden': true, size: 16, strokeWidth: 1.75 } as const;
    return availability === 'online' ? (
        <CircleCheck {...props} />
    ) : availability === 'offline' ? (
        <WifiOff {...props} />
    ) : undefined;
}
function cardAlert(
    reading: ReturnType<typeof toTemperatureSensorReading>,
    realtimeUncertain: boolean,
): {
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
            ? `Temperature telemetry is stale. Showing the last known reading from ${reading.recordedAt.slice(11, 19)} UTC.`
            : undefined,
        realtimeUncertain
            ? 'Realtime stream is reconnecting. Showing the last valid temperature update.'
            : undefined,
    ].filter((message): message is string => message !== undefined);
    if (messages.length > 0) return { message: messages.join(' '), variant: 'warning' };
    return reading.recordedAt
        ? { message: `Last reading ${reading.recordedAt.slice(11, 19)} UTC.`, variant: 'info' }
        : { message: 'No reading received yet.', variant: 'info' };
}
