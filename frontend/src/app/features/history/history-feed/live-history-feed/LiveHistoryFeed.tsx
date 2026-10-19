import { LoaderCircle } from 'lucide-react';
import { type Ref, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, Button } from '../../../../ui';
import { useHistoryContext } from '../../history-context';
import type { HistoryFeedHandle } from '../history-feed-handle';
import { LiveHistoryList } from '../live-history-list/LiveHistoryList';

import styles from './LiveHistoryFeed.module.css';
import { useLiveHistoryFeed } from './useLiveHistoryFeed';

export function LiveHistoryFeed({ ref }: { ref?: Ref<HistoryFeedHandle> }) {
    const context = useHistoryContext();

    if (context.mode !== 'live') {
        throw new Error('LiveHistoryFeed requires live mode');
    }

    const { history, devices, waitingForRoom, realtimeUncertain } = context;
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
                            <LiveHistoryList
                                state={state}
                                devices={devices}
                                realtimeUncertain={realtimeUncertain}
                                scrollRoot={scrollRoot}
                                customScrollParent={scrollParent}
                                returningToTop={returningToTop}
                                updateReadingPosition={history.updateReadingPosition}
                                loadOlder={history.loadOlder}
                            />
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
