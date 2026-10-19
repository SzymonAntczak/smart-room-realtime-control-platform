import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import type { ContextProp, ItemProps } from 'react-virtuoso';

import { HistoryFeedItem } from '../../../../features/user-history';
import type { EventHistoryContext } from '../event-history-context';

export function HistoryRow({
    item,
    'data-index': index,
    style,
    context,
}: ItemProps<UserHistoryItem> & ContextProp<EventHistoryContext>) {
    return (
        <HistoryFeedItem
            item={item}
            deviceName={context.deviceName}
            index={index}
            setSize={context.endReached ? context.totalItems : -1}
            style={style}
        />
    );
}
