import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import type { CSSProperties, Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../i18n/time';
import { getDeviceDisplayName } from '../shared/device-presentation';
import type { RenderableDeviceProjection } from '../shared/room-rendering';

import { describeUserHistory } from './user-history-presentation';
import styles from './UserHistoryItemRow.module.css';

export function UserHistoryItemRow({
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
            <p>{describeUserHistory(item, t)}</p>
            <div className={styles.context}>
                <time dateTime={item.occurredAt}>{formatTimestamp(item.occurredAt)}</time>
                {item.durability === 'volatile' ? (
                    <span className={styles.volatile}>{t('feed.volatile')}</span>
                ) : null}
            </div>
        </li>
    );
}
