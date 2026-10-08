import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { type Components, Virtuoso } from 'react-virtuoso';

import type { RenderableDeviceProjection } from '../../../device-projection';
import type { HistoryReadingPosition, HistorySessionState } from '../history-session';

import type { HistoryFeedContext } from './history-feed-context';
import { HistoryFeedList } from './history-feed-list/HistoryFeedList';
import { HistoryFeedRow } from './history-feed-row/HistoryFeedRow';
import styles from './HistoryFeed.module.css';
import { useHistoryPaging } from './useHistoryPaging';
import { useHistoryVirtualizer } from './useHistoryVirtualizer';

const components: Components<UserHistoryItem, HistoryFeedContext, HTMLUListElement> = {
    List: HistoryFeedList,
    Item: HistoryFeedRow,
};

export function HistoryFeed({
    state,
    devices,
    realtimeUncertain,
    scrollRoot,
    customScrollParent,
    returningToTop,
    updateReadingPosition,
    loadOlder,
}: {
    state: HistorySessionState;
    devices: readonly RenderableDeviceProjection[];
    realtimeUncertain: boolean;
    scrollRoot: RefObject<HTMLElement | null>;
    customScrollParent: HTMLElement | null;
    returningToTop: boolean;
    updateReadingPosition(position: HistoryReadingPosition | null): void;
    loadOlder(): void;
}) {
    const { t } = useTranslation('dashboard');
    const { virtuosoRef } = useHistoryVirtualizer({
        state,
        scrollRoot,
        returningToTop,
        updateReadingPosition,
    });
    useHistoryPaging({
        state,
        scrollViewport: customScrollParent,
        loadOlder,
        returningToTop,
    });

    const context: HistoryFeedContext = {
        devices,
        endReached: state.endReached,
        totalItems: state.items.length,
    };

    return (
        <div className={styles.feed}>
            {realtimeUncertain ? <p className={styles.notice}>{t('feed.lastKnown')}</p> : null}
            {state.items.length === 0 ? <p className={styles.empty}>{t('feed.empty')}</p> : null}
            <Virtuoso
                ref={virtuosoRef}
                data={state.items}
                customScrollParent={customScrollParent ?? undefined}
                components={components}
                context={context}
                computeItemKey={(_index, item) => item.recordId}
                defaultItemHeight={192}
                minOverscanItemCount={{ top: 5, bottom: 5 }}
                itemContent={() => null}
            />
        </div>
    );
}
