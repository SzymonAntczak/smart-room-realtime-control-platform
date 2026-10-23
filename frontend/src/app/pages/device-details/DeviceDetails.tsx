import type { LiveTelemetrySampleProjection } from '@smart-room/contracts/history';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { formatTimestamp } from '../../features/date-time';
import { getDeviceDisplayName } from '../../features/device-display';
import { HistoryFeed, HistoryFilters, HistoryProvider } from '../../features/history';
import { Button, ButtonLink, StatusTag } from '../../ui';

import styles from './DeviceDetails.module.css';
import { TelemetryChart } from './telemetry-chart/TelemetryChart';
import { TelemetryTable } from './telemetry-table/TelemetryTable';
import { useDeviceDetails } from './useDeviceDetails';
import { useDeviceTelemetry } from './useDeviceTelemetry';

const noTelemetry: readonly LiveTelemetrySampleProjection[] = [];

export function DeviceDetails() {
    const { deviceId } = useParams();
    const { t } = useTranslation('deviceDetails');
    const headingRef = useRef<HTMLHeadingElement>(null);
    const state = useDeviceDetails(deviceId);

    useEffect(() => {
        headingRef.current?.focus();
    }, [deviceId]);

    const isReady = state.status === 'ready';
    const device = isReady ? state.device : undefined;
    const temperatureObservation =
        device?.role === 'temperature-sensor' ? device.observationStatus.temperature : undefined;
    const telemetry = useDeviceTelemetry(
        device?.role === 'temperature-sensor' ? device.deviceId : undefined,
    );
    const telemetryState = telemetry.state;
    const samples = telemetryState?.samples ?? noTelemetry;
    const telemetryStatus = telemetryState?.status ?? 'loading';
    const telemetryLoading =
        telemetryStatus === 'loading' ||
        telemetryStatus === 'idle' ||
        telemetryStatus === 'waiting_for_baseline';
    const emptyTelemetryMessage = t(
        telemetryStatus === 'error'
            ? 'telemetry.failed'
            : telemetryStatus === 'ready'
              ? 'telemetry.empty'
              : 'telemetry.loading',
    );
    const name = device
        ? getDeviceDisplayName(device, (key) => t(key, { ns: 'dashboard' }))
        : undefined;

    return (
        <main className={styles.page}>
            <ButtonLink
                to="/"
                state={{ focusDashboard: true }}
                viewTransition
                variant="text"
                className={styles.backLink}
            >
                <ArrowLeft aria-hidden="true" size={18} />
                {t('back')}
            </ButtonLink>
            <h1 ref={headingRef} tabIndex={-1}>
                {name ? t('title', { name }) : t('heading')}
            </h1>

            {state.status === 'connecting' ? (
                <p role="status">{t('connecting')}</p>
            ) : state.connectionStatus === 'reconnecting' ? (
                <p role="status">{t('reconnecting')}</p>
            ) : null}

            {state.status === 'ready' && state.contractError ? (
                <p role="status">{t('contractUncertain')}</p>
            ) : null}

            {state.status === 'ready' && !device ? <p role="status">{t('notFound')}</p> : null}

            {device ? (
                <>
                    <section className={styles.summary} aria-labelledby="device-summary-heading">
                        <h2 id="device-summary-heading">{t('summary')}</h2>
                        <dl>
                            <div>
                                <dt>{t('name')}</dt>
                                <dd>{name}</dd>
                            </div>
                            <div>
                                <dt>{t('identifier')}</dt>
                                <dd>{device.deviceId}</dd>
                            </div>
                            <div>
                                <dt>{t('role')}</dt>
                                <dd>{t(`roles.${device.role}`)}</dd>
                            </div>
                            <div>
                                <dt>{t('availability')}</dt>
                                <dd>
                                    <StatusTag tone={availabilityTone(device.availability)}>
                                        {t(`availability.${device.availability}`, { ns: 'common' })}
                                    </StatusTag>
                                </dd>
                            </div>
                        </dl>
                    </section>

                    {device.role === 'temperature-sensor' ? (
                        <section className={styles.telemetry} aria-labelledby="telemetry-heading">
                            <h2 id="telemetry-heading">{t('telemetryTitle')}</h2>
                            <p role="status" aria-label={t('telemetry.observationStatus')}>
                                {t(
                                    `telemetry.freshness.${temperatureObservation?.freshness ?? 'unknown'}`,
                                )}
                                {temperatureObservation?.lastObservedAt ? (
                                    <>
                                        {' · '}
                                        {t('telemetry.lastObserved')}:{' '}
                                        <time dateTime={temperatureObservation.lastObservedAt}>
                                            {formatTimestamp(temperatureObservation.lastObservedAt)}
                                        </time>
                                    </>
                                ) : null}
                            </p>
                            <p>{t('telemetry.baseline')}</p>
                            {telemetryState?.range ? (
                                <p>
                                    {t('telemetry.range', {
                                        from: formatTimestamp(telemetryState.range.from),
                                        to: formatTimestamp(telemetryState.range.to),
                                    })}
                                </p>
                            ) : null}
                            <p>{t('telemetry.count', { count: samples.length })}</p>
                            <div role="status">
                                {telemetryLoading ? <p>{t('telemetry.loading')}</p> : null}
                                {telemetryStatus === 'ready' && samples.length === 0 ? (
                                    <p>{t('telemetry.empty')}</p>
                                ) : null}
                                {telemetryState?.limitReached ? (
                                    <p>{t('telemetry.limit')}</p>
                                ) : null}
                                {telemetryState?.lastKnown ? <p>{t('telemetry.partial')}</p> : null}
                                {telemetryState?.error ? (
                                    <p>{t(`telemetry.errors.${telemetryState.error}`)}</p>
                                ) : null}
                            </div>
                            {telemetryStatus === 'error' ? (
                                <Button variant="outlined" onClick={telemetry.retry}>
                                    {t('telemetry.retry')}
                                </Button>
                            ) : null}
                            <TelemetryChart samples={samples} />
                            <TelemetryTable
                                samples={samples}
                                emptyMessage={emptyTelemetryMessage}
                            />
                        </section>
                    ) : null}

                    <section className={styles.history} aria-labelledby="event-history-title">
                        <h2 id="event-history-title">{t('eventHistory.title')}</h2>
                        <p>{t('eventHistory.completeness')}</p>
                        <HistoryProvider key={device.deviceId} mode="search" devices={[device]}>
                            <HistoryFilters device={device} />
                            <HistoryFeed />
                        </HistoryProvider>
                    </section>
                </>
            ) : null}
        </main>
    );
}

function availabilityTone(availability: 'online' | 'offline' | 'unknown') {
    return availability === 'online'
        ? 'success'
        : availability === 'offline'
          ? 'danger'
          : 'warning';
}
