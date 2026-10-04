import { ArrowUp, ListFilter, LoaderCircle } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { RoomHistorySource } from '../realtime/room-history-source';
import type { RenderableDeviceProjection } from '../shared/room-rendering';
import { Alert } from '../shared/ui/Alert';

import { RecentEventsFeed } from './RecentEventsFeed';
import { useUserHistory } from './use-user-history';
import styles from './UserHistoryPanel.module.css';

export function UserHistoryPanel({
    source,
    devices,
    realtimeUncertain,
    waitingForRoom,
}: {
    source: RoomHistorySource;
    devices: readonly RenderableDeviceProjection[];
    realtimeUncertain: boolean;
    waitingForRoom: boolean;
}) {
    const { t } = useTranslation('dashboard');
    const history = useUserHistory(source);
    const scrollRoot = useRef<HTMLDivElement | null>(null);
    const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [topTooltip, setTopTooltip] = useState(false);
    const { state } = history;

    useEffect(() => {
        if (!topTooltip) {
            return;
        }

        const hide = () => setTopTooltip(false);

        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                hide();
            }
        };

        const root = scrollRoot.current;
        tooltipTimer.current = setTimeout(hide, 3000);
        root?.addEventListener('scroll', hide, { once: true });
        document.addEventListener('keydown', onKeyDown);

        return () => {
            if (tooltipTimer.current !== null) {
                clearTimeout(tooltipTimer.current);
                tooltipTimer.current = null;
            }

            root?.removeEventListener('scroll', hide);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [topTooltip]);

    function handleTopKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (event.key === 'Escape') {
            setTopTooltip(false);
        }
    }

    function handleReturnToTop() {
        const root = scrollRoot.current;

        if (root && root.scrollTop <= 1) {
            setTopTooltip(true);

            return;
        }

        setTopTooltip(false);
        history.showNewest();
    }

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <h2 id="recent-events-heading">{t('history.title')}</h2>
            </div>
            <div
                className={styles.content}
                ref={scrollRoot}
                role="region"
                aria-label={t('history.scrollRegion')}
                tabIndex={0}
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
                        <RecentEventsFeed
                            state={state}
                            devices={devices}
                            realtimeUncertain={realtimeUncertain}
                            scrollRoot={scrollRoot}
                            updateReadingPosition={history.updateReadingPosition}
                            loadOlder={history.loadOlder}
                        />
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
                                <button type="button" onClick={history.retry}>
                                    {t('history.retry')}
                                </button>
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
            <footer className={styles.footer}>
                <button
                    type="button"
                    className={styles.filterButton}
                    aria-label={t('history.filter')}
                >
                    <ListFilter aria-hidden="true" size={18} />
                    <span>{t('history.filter')}</span>
                </button>
                <div className={styles.topAction}>
                    {topTooltip ? (
                        <span id="history-top-tooltip" role="tooltip" className={styles.tooltip}>
                            {t('history.alreadyAtTop')}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        className={styles.topButton}
                        aria-label={t('history.returnToTop')}
                        aria-describedby={topTooltip ? 'history-top-tooltip' : undefined}
                        onClick={handleReturnToTop}
                        onBlur={() => setTopTooltip(false)}
                        onKeyDown={handleTopKeyDown}
                    >
                        <ArrowUp aria-hidden="true" size={18} />
                        <span>{t('history.returnToTop')}</span>
                    </button>
                </div>
            </footer>
        </div>
    );
}
