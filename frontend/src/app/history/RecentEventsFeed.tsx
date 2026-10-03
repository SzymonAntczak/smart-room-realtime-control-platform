import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../i18n/time';
import { getDeviceDisplayName } from '../shared/device-presentation';
import type { RenderableDeviceProjection } from '../shared/room-rendering';

import styles from './RecentEventsFeed.module.css';
import { describeUserHistory } from './user-history-presentation';

export function RecentEventsFeed({
    events,
    devices,
    realtimeUncertain,
    registerEntry,
}: {
    events: readonly UserHistoryItem[];
    devices: readonly RenderableDeviceProjection[];
    realtimeUncertain: boolean;
    registerEntry?(recordId: string, element: HTMLElement | null): void;
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
                        const device =
                            'deviceId' in event
                                ? devices.find((candidate) => candidate.deviceId === event.deviceId)
                                : undefined;
                        const deviceName =
                            device !== undefined
                                ? getDeviceDisplayName(device, (key) => t(key))
                                : 'deviceId' in event
                                  ? event.deviceName
                                  : t('history.room');

                        return (
                            <li
                                className={styles.entry}
                                key={event.recordId}
                                data-testid={`history-item-${event.recordId}`}
                                ref={(element) => registerEntry?.(event.recordId, element)}
                            >
                                <strong>{deviceName}</strong>
                                <p>{describeUserHistory(event, t)}</p>
                                <div className={styles.context}>
                                    <time dateTime={event.occurredAt}>
                                        {formatTimestamp(event.occurredAt)}
                                    </time>
                                    {event.durability === 'volatile' ? (
                                        <span className={styles.volatile}>
                                            {t('feed.volatile')}
                                        </span>
                                    ) : null}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}
