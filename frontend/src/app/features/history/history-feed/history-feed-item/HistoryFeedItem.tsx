import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../../date-time';

import styles from './HistoryFeedItem.module.css';

export function HistoryFeedItem({
    item,
    deviceName,
}: {
    item: UserHistoryItem;
    deviceName?: string;
}) {
    const { t } = useTranslation('dashboard');
    const resolvedDeviceName =
        deviceName ?? ('deviceId' in item ? item.deviceName : t('history.room'));

    return (
        <article className={styles.entry}>
            <strong>{resolvedDeviceName}</strong>
            <p>{describeHistoryItem(item, t)}</p>
            <div className={styles.context}>
                <time dateTime={item.occurredAt}>{formatTimestamp(item.occurredAt)}</time>
                {item.durability === 'volatile' ? (
                    <span className={styles.volatile}>{t('feed.volatile')}</span>
                ) : null}
            </div>
        </article>
    );
}

function describeHistoryItem(item: UserHistoryItem, t: TFunction<'dashboard'>): string {
    switch (item.kind) {
        case 'power_changed':
            return t(item.previous === null ? 'history.powerObserved' : 'history.powerChanged', {
                previous: item.previous === null ? '' : t(`led.${item.previous}`),
                current: t(`led.${item.current}`),
            });
        case 'availability_changed':
            return t(
                item.previous === null
                    ? 'history.availabilityObserved'
                    : 'feed.availabilityChanged',
                {
                    previous: item.previous === null ? '' : t(`feed.availability.${item.previous}`),
                    current: t(`feed.availability.${item.current}`),
                },
            );
        case 'health_changed':
            return t(item.previous === null ? 'history.healthObserved' : 'feed.healthChanged', {
                previous: item.previous === null ? '' : t(`feed.health.${item.previous}`),
                current: t(`feed.health.${item.current}`),
            });
        case 'attempt_failed':
            return t('history.failed');
        case 'confirmation_missing':
            return t('history.confirmationMissing', { power: t(`led.${item.requestedPower}`) });
        case 'history_gap':
            return t('feed.gapInterval', {
                from: formatTimestamp(item.outageStartedAt),
                to: formatTimestamp(item.outageEndedAt),
            });
    }
}
