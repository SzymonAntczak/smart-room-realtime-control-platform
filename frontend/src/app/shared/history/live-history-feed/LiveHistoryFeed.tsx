import { LoaderCircle } from 'lucide-react';
import { type Ref, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';

import { getDeviceDisplayName } from '../../device-display';
import { InfiniteList } from '../../infinite-scrolling';
import { Alert, Button } from '../../ui';
import { HistoryEntry } from '../history-entry/HistoryEntry';
import type { HistoryLiveSource } from '../history-live-source';
import { useLiveHistory } from '../useLiveHistory';

import type { HistoryFeedHandle } from './history-feed-handle';
import styles from './LiveHistoryFeed.module.css';
import { useHistoryReadingPosition } from './useHistoryReadingPosition';
import { useLiveHistoryFeed } from './useLiveHistoryFeed';

export function LiveHistoryFeed({
    ref,
    source,
    devices,
    waitingForRoom,
    realtimeUncertain,
}: {
    ref?: Ref<HistoryFeedHandle>;
    source: HistoryLiveSource;
    devices: readonly { deviceId: string; name: string }[];
    waitingForRoom: boolean;
    realtimeUncertain: boolean;
}) {
    const history = useLiveHistory(source);
    const { state } = history;
    const { t } = useTranslation('dashboard');
    const {
        scrollRoot,
        scrollParent,
        returningToTop,
        attachScrollRoot,
        handleHistoryKeyDown,
        handleReturnToTop,
    } = useLiveHistoryFeed(history);
    const { virtuosoRef } = useHistoryReadingPosition({
        state,
        scrollRoot,
        returningToTop,
        updateReadingPosition: history.updateReadingPosition,
    });
    useImperativeHandle(ref, () => ({ scrollToTop: handleReturnToTop }), [handleReturnToTop]);

    return (
        <div className={styles.panel}>
            <div
                className={styles.content}
                ref={attachScrollRoot}
                role="region"
                aria-label={t('history.scrollRegion')}
                tabIndex={0}
                onKeyDown={handleHistoryKeyDown}
            >
                {waitingForRoom ? (
                    <p className={styles.status} role="status">
                        {t('feed.connecting')}
                    </p>
                ) : (
                    <>
                        {state.lastKnown ? (
                            <p className={styles.notice} role="status">
                                {t('history.lastKnown')}
                            </p>
                        ) : null}
                        {state.notice ? (
                            <p className={styles.notice} role="status">
                                {t(`history.${state.notice}`)}
                            </p>
                        ) : null}
                        {state.overlayOverflow ? (
                            <p className={styles.notice}>{t('history.overflow')}</p>
                        ) : null}
                        {scrollParent ? (
                            <div className={styles.feed}>
                                {realtimeUncertain ? (
                                    <p className={styles.feedNotice}>{t('feed.lastKnown')}</p>
                                ) : null}
                                {state.items.length === 0 ? (
                                    <p className={styles.empty}>{t('feed.empty')}</p>
                                ) : null}
                                <InfiniteList
                                    ref={virtuosoRef}
                                    items={state.items}
                                    getItemKey={(item) => item.recordId}
                                    getItemTestId={(item) => 'history-item-' + item.recordId}
                                    renderItem={(item) => {
                                        const device = devices.find(
                                            (d) =>
                                                'deviceId' in item && d.deviceId === item.deviceId,
                                        );

                                        return (
                                            <HistoryEntry
                                                item={item}
                                                deviceName={
                                                    device
                                                        ? getDeviceDisplayName(device, (key) =>
                                                              t(key),
                                                          )
                                                        : undefined
                                                }
                                            />
                                        );
                                    }}
                                    scrollParent={scrollParent}
                                    ariaLabel={t('history.scrollRegion')}
                                    hasMore={
                                        state.status === 'ready' &&
                                        !state.error &&
                                        state.nextCursor !== null &&
                                        !state.endReached
                                    }
                                    loading={state.status === 'loading'}
                                    endReached={state.endReached}
                                    onLoadMore={history.loadOlder}
                                    suspended={returningToTop}
                                />
                            </div>
                        ) : null}
                        {state.status === 'loading' ? (
                            <p className={`${styles.status} ${styles.loading}`} role="status">
                                <LoaderCircle aria-hidden="true" size={18} />
                                <span>{t('history.loading')}</span>
                            </p>
                        ) : null}
                        {state.status === 'waiting_for_baseline' ? (
                            <p className={`${styles.status} ${styles.loading}`} role="status">
                                <LoaderCircle aria-hidden="true" size={18} />
                                <span>{t('history.loading')}</span>
                            </p>
                        ) : null}
                        {state.error ? (
                            <div className={styles.status} role="alert">
                                <p>{t(`history.errors.${state.error}`)}</p>
                                <Button variant="outlined" type="button" onClick={history.retry}>
                                    {t('history.retry')}
                                </Button>
                            </div>
                        ) : null}
                        {state.endReached ? (
                            <div className={styles.historyEnd} role="status">
                                <Alert message={t('history.end')} variant="info" />
                            </div>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
}
