import type { RawTelemetrySampleProjection } from '@smart-room/contracts/history';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { getDeviceDisplayName } from '../../features/device-display';
import { HistoryFeed, HistoryFilters, HistoryProvider } from '../../features/history';
import { ButtonLink, StatusTag } from '../../ui';

import styles from './DeviceDetails.module.css';
import { TelemetryChart } from './telemetry-chart/TelemetryChart';
import { TelemetryTable } from './telemetry-table/TelemetryTable';
import { useDeviceDetails } from './useDeviceDetails';

const noTelemetry: readonly RawTelemetrySampleProjection[] = [];

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
                            <p>{t('historyUnavailable')}</p>
                            <TelemetryChart samples={noTelemetry} />
                            <TelemetryTable samples={noTelemetry} />
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
