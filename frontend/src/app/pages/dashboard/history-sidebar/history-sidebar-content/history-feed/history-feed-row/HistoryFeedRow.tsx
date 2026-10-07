import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import type { ContextProp, ItemProps } from 'react-virtuoso';

import type { HistoryFeedContext } from '../history-feed-context';
import { HistoryFeedItem } from '../history-feed-item/HistoryFeedItem';

export function HistoryFeedRow({
    item,
    'data-index': index,
    style,
    context,
}: ItemProps<UserHistoryItem> & ContextProp<HistoryFeedContext>) {
    return (
        <HistoryFeedItem
            item={item}
            devices={context.devices}
            index={index}
            setSize={context.endReached ? context.totalItems : -1}
            style={style}
        />
    );
}
