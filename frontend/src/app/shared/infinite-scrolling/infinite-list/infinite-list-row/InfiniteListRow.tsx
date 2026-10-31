import type { ContextProp, ItemProps } from 'react-virtuoso';

import type { InfiniteListContext } from '../infinite-list-context';

export function InfiniteListRow<T>({
    item,
    'data-index': index,
    style,
    context,
}: ItemProps<T> & ContextProp<InfiniteListContext<T>>) {
    return (
        <li
            data-index={index}
            data-testid={context.getItemTestId?.(item)}
            style={style}
            aria-posinset={index + 1}
            aria-setsize={context.endReached ? context.totalItems : -1}
        >
            {context.renderItem(item, index)}
        </li>
    );
}
