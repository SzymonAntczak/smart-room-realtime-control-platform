import type { DeviceProjection } from '@smart-room/contracts/projections';
import { CircleCheck, Thermometer, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../../i18n/time';
import { getDeviceDisplayName } from '../../shared/device-presentation';
import { Alert, type AlertVariant } from '../../shared/ui/Alert';
import { ControlCard } from '../../shared/ui/ControlCard';

import { toTemperatureSensorReading } from './temperature-reading';
import styles from './TemperatureControl.module.css';

export function TemperatureControl({
    device,
    headerAction,
    realtimeUncertain = false,
}: {
    device: DeviceProjection;
    headerAction?: ReactNode;
    realtimeUncertain?: boolean;
}) {
    const { t } = useTranslation(['common', 'dashboard']);

    if (device.role !== 'temperature-sensor') {
        return null;
    }

    const reading = toTemperatureSensorReading(device);

    return (
        <ControlCard
            title={getDeviceDisplayName(device, (key) => t(key, { ns: 'dashboard' }))}
            titleId={`sensor-heading-${reading.sensorId}`}
            testId={`${reading.sensorId}-temperature-card`}
            status={t(`availability.${reading.availability}`, { ns: 'common' })}
            statusIcon={availabilityIcon(reading.availability)}
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
        </ControlCard>
    );
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
