import type { DeviceProjection } from '@smart-room/contracts/projections';
import { CircleCheck, Thermometer, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../../features/date-time';
import { Alert, type AlertVariant, DeviceCard } from '../../../ui';
import { getDeviceDisplayName } from '../device-display-name';

import styles from './TemperatureCard.module.css';

type ObservationStatus = DeviceProjection['observationStatus'][string];

export interface TemperatureSensorDeviceProjection extends Omit<
    DeviceProjection,
    'observationStatus' | 'reportedState' | 'role'
> {
    readonly role: 'temperature-sensor';
    readonly reportedState: DeviceProjection['reportedState'] & {
        readonly temperature?: number;
        readonly temperatureUnit?: 'celsius';
    };
    readonly observationStatus: DeviceProjection['observationStatus'] & {
        readonly temperature: ObservationStatus;
    };
}

export function TemperatureCard({
    device,
    headerAction,
    realtimeUncertain = false,
}: {
    device: TemperatureSensorDeviceProjection;
    headerAction?: ReactNode;
    realtimeUncertain?: boolean;
}) {
    const { t } = useTranslation(['common', 'dashboard']);

    const reading = toTemperatureCardViewModel(device);
    const AvailabilityIcon =
        reading.availability === 'online'
            ? CircleCheck
            : reading.availability === 'offline'
              ? WifiOff
              : undefined;

    return (
        <DeviceCard
            title={getDeviceDisplayName(device, (key) => t(key, { ns: 'dashboard' }))}
            titleId={`sensor-heading-${reading.sensorId}`}
            testId={`${reading.sensorId}-temperature-card`}
            status={t(`availability.${reading.availability}`, { ns: 'common' })}
            statusIcon={
                AvailabilityIcon ? (
                    <AvailabilityIcon aria-hidden="true" size={16} strokeWidth={1.75} />
                ) : undefined
            }
            statusTone={availabilityTone(reading.availability)}
            headerAction={headerAction}
            bottomAlert={
                <Alert
                    {...cardAlert(reading, realtimeUncertain, t)}
                    testId={`${reading.sensorId}-temperature-alert`}
                />
            }
        >
            <div
                className={styles.reading}
                aria-label={t('temperature.current', { ns: 'dashboard' })}
                data-testid={`${reading.sensorId}-temperature-reading`}
            >
                <Thermometer
                    aria-hidden="true"
                    className={styles.readingIcon}
                    size={24}
                    strokeWidth={1.75}
                />
                <span className={styles.value}>{reading.value?.toFixed(1) ?? '—'}</span>
                <span className={styles.unit}>
                    {reading.unit
                        ? t(`temperature.units.${reading.unit}`, { ns: 'dashboard' })
                        : ''}
                </span>
            </div>
        </DeviceCard>
    );
}

function availabilityTone(availability: 'online' | 'offline' | 'unknown') {
    return availability === 'online'
        ? 'success'
        : availability === 'offline'
          ? 'danger'
          : 'warning';
}

function cardAlert(
    reading: ReturnType<typeof toTemperatureCardViewModel>,
    realtimeUncertain: boolean,
    t: ReturnType<typeof useTranslation>['t'],
): {
    message?: string;
    variant?: AlertVariant;
} {
    const messages = [
        reading.availability === 'offline'
            ? t('temperature.alert.offline', {
                  ns: 'dashboard',
                  reason: reading.availabilityReason ? `: ${reading.availabilityReason}` : '.',
              })
            : undefined,
        reading.health === 'degraded'
            ? (reading.healthReason ?? t('temperature.alert.degraded', { ns: 'dashboard' }))
            : undefined,
        reading.freshness === 'stale' && reading.recordedAt
            ? t('temperature.alert.stale', {
                  ns: 'dashboard',
                  time: formatTimestamp(reading.recordedAt),
              })
            : undefined,
        realtimeUncertain
            ? t('temperature.alert.realtimeReconnecting', { ns: 'dashboard' })
            : undefined,
    ].filter((message): message is string => message !== undefined);

    if (messages.length > 0) {
        return { message: messages.join(' '), variant: 'warning' };
    }

    return reading.recordedAt
        ? {
              message: t('temperature.alert.lastReading', {
                  ns: 'dashboard',
                  time: formatTimestamp(reading.recordedAt),
              }),
              variant: 'info',
          }
        : { message: t('temperature.alert.noReading', { ns: 'dashboard' }), variant: 'info' };
}

interface TemperatureCardViewModel {
    sensorId: string;
    sensorName: string;
    value?: number;
    unit?: 'celsius';
    recordedAt?: string;
    availability: TemperatureSensorDeviceProjection['availability'];
    availabilityReason?: string;
    health: TemperatureSensorDeviceProjection['health'];
    healthReason?: string;
    freshness: 'fresh' | 'stale' | 'unknown';
}

function toTemperatureCardViewModel(
    device: TemperatureSensorDeviceProjection,
): TemperatureCardViewModel {
    const hasReading =
        typeof device.reportedState.temperature === 'number' &&
        device.reportedState.temperatureUnit === 'celsius' &&
        typeof device.observationStatus.temperature?.lastObservedAt === 'string';

    return {
        sensorId: device.deviceId,
        sensorName: device.name,
        ...(hasReading
            ? {
                  value: device.reportedState.temperature,
                  unit: device.reportedState.temperatureUnit,
                  recordedAt: device.observationStatus.temperature.lastObservedAt,
              }
            : {}),
        availability: device.availability,
        availabilityReason: device.availabilityReason,
        health: device.health,
        healthReason: device.healthReason,
        freshness: device.observationStatus.temperature.freshness,
    };
}
