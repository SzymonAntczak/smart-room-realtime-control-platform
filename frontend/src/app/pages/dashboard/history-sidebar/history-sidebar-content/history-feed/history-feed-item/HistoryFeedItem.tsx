import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import type { TFunction } from 'i18next';
import type { CSSProperties, Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../../../../../features/date-time';
import { getDeviceDisplayName } from '../../../../device-display-name';
import type { RenderableDeviceProjection } from '../../../../device-projection';

import styles from './HistoryFeedItem.module.css';

export function HistoryFeedItem({
    item,
    devices,
    index,
    setSize,
    style,
    ref,
}: {
    item: UserHistoryItem;
    devices: readonly RenderableDeviceProjection[];
    index: number;
    setSize: number;
    style?: CSSProperties;
    ref?: Ref<HTMLLIElement>;
}) {
    const { t } = useTranslation('dashboard');
    const device =
        'deviceId' in item
            ? devices.find((candidate) => candidate.deviceId === item.deviceId)
            : undefined;
    const deviceName = device
        ? getDeviceDisplayName(device, (key) => t(key))
        : 'deviceId' in item
          ? item.deviceName
          : t('history.room');

    return (
        <li
            className={styles.entry}
            data-index={index}
            data-testid={`history-item-${item.recordId}`}
            aria-posinset={index + 1}
            aria-setsize={setSize}
            style={style}
            ref={ref}
        >
            <strong>{deviceName}</strong>
            <p>{describeHistoryItem(item, t)}</p>
            <div className={styles.context}>
                <time dateTime={item.occurredAt}>{formatTimestamp(item.occurredAt)}</time>
                {item.durability === 'volatile' ? (
                    <span className={styles.volatile}>{t('feed.volatile')}</span>
                ) : null}
            </div>
        </li>
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
