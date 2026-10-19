import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import { useTranslation } from 'react-i18next';
import type { ContextProp, ItemProps } from 'react-virtuoso';

import { getDeviceDisplayName } from '../../../device-display';
import type { HistoryFeedContext } from '../history-feed-context';
import { HistoryFeedItem } from '../history-feed-item/HistoryFeedItem';

export function HistoryFeedRow({
    item,
    'data-index': index,
    style,
    context,
}: ItemProps<UserHistoryItem> & ContextProp<HistoryFeedContext>) {
    const { t } = useTranslation('dashboard');
    const device =
        'deviceId' in item
            ? context.devices.find((candidate) => candidate.deviceId === item.deviceId)
            : undefined;
    const deviceName = device ? getDeviceDisplayName(device, (key) => t(key)) : undefined;

    return (
        <HistoryFeedItem
            item={item}
            deviceName={deviceName}
            index={index}
            setSize={context.endReached ? context.totalItems : -1}
            style={style}
        />
    );
}
