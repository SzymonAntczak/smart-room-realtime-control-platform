import type { RecentEventProjection } from '@smart-room/contracts/history';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../i18n/time';
import { getDeviceDisplayName } from '../shared/device-presentation';
import type { RenderableDeviceProjection } from '../shared/room-rendering';

import { presentRecentEvent } from './recent-event-presentation';
import styles from './RecentEventsFeed.module.css';

export function RecentEventsFeed({
    events,
    devices,
    realtimeUncertain,
}: {
    events: readonly RecentEventProjection[];
    devices: readonly RenderableDeviceProjection[];
    realtimeUncertain: boolean;
}) {
    const { t } = useTranslation('dashboard');

    return (
        <section className={styles.feed} aria-labelledby="recent-events-heading">
            <h2 id="recent-events-heading">{t('feed.heading')}</h2>
            {realtimeUncertain ? <p className={styles.notice}>{t('feed.lastKnown')}</p> : null}
            {events.length === 0 ? (
                <p className={styles.empty}>{t('feed.empty')}</p>
            ) : (
                <ol className={styles.list}>
                    {events.map((event) => {
                        const presentation = presentRecentEvent(event, t);
                        const device =
                            'deviceId' in event
                                ? devices.find((candidate) => candidate.deviceId === event.deviceId)
                                : undefined;
                        const deviceName =
                            device !== undefined
                                ? getDeviceDisplayName(device, (key) => t(key))
                                : 'deviceId' in event
                                  ? event.deviceId
                                  : undefined;

                        return (
                            <li className={styles.entry} key={event.recordId}>
                                <strong>{presentation.summary}</strong>
                                <div className={styles.context}>
                                    {deviceName ? <span>{deviceName}</span> : null}
                                    <time dateTime={event.occurredAt}>
                                        {formatTimestamp(event.occurredAt)}
                                    </time>
                                    {event.durability === 'volatile' ? (
                                        <span className={styles.volatile}>
                                            {t('feed.volatile')}
                                        </span>
                                    ) : null}
                                </div>
                                {event.eventType === 'storage.gap.recorded' ? (
                                    <p className={styles.interval}>
                                        {t('feed.gapInterval', {
                                            from: formatTimestamp(event.payload.outageStartedAt),
                                            to: formatTimestamp(event.payload.outageEndedAt),
                                        })}
                                    </p>
                                ) : null}
                                {presentation.details.length > 0 ? (
                                    <details className={styles.details}>
                                        <summary>{t('feed.details')}</summary>
                                        <dl>
                                            {presentation.details.map((detail) => (
                                                <div key={detail.label}>
                                                    <dt>{detail.label}</dt>
                                                    <dd>{detail.value}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    </details>
                                ) : null}
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}
