import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { getDeviceDisplayName } from '../../../device-display';
import { InfiniteList } from '../../../infinite-scrolling';
import type { HistoryDevice } from '../../history-context';
import { HistoryFeedItem } from '../history-feed-item/HistoryFeedItem';
import type { HistoryReadingPosition, HistorySessionState } from '../history-session';

import styles from './LiveHistoryList.module.css';
import { useHistoryVirtualizer } from './useHistoryVirtualizer';

export function LiveHistoryList({
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
    devices: readonly HistoryDevice[];
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

    return (
        <div className={styles.feed}>
            {realtimeUncertain ? <p className={styles.notice}>{t('feed.lastKnown')}</p> : null}
            {state.items.length === 0 ? <p className={styles.empty}>{t('feed.empty')}</p> : null}
            <InfiniteList
                ref={virtuosoRef}
                items={state.items}
                getItemKey={(item) => item.recordId}
                getItemTestId={(item) => 'history-item-' + item.recordId}
                renderItem={(item) => {
                    const device = devices.find(
                        (d) => 'deviceId' in item && d.deviceId === item.deviceId,
                    );

                    return (
                        <HistoryFeedItem
                            item={item}
                            deviceName={
                                device ? getDeviceDisplayName(device, (key) => t(key)) : undefined
                            }
                        />
                    );
                }}
                scrollParent={customScrollParent}
                ariaLabel={t('history.scrollRegion')}
                hasMore={
                    state.status === 'ready' &&
                    !state.error &&
                    state.nextCursor !== null &&
                    !state.endReached
                }
                loading={state.status === 'loading'}
                endReached={state.endReached}
                onLoadMore={loadOlder}
                suspended={returningToTop}
            />{' '}
        </div>
    );
}
