import { ArrowUp, ListFilter, LoaderCircle } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert } from '../../../../ui';
import type { RenderableDeviceProjection } from '../../device-projection';
import type { RoomHistorySource } from '../../room-history-source';

import { HistoryFeed } from './history-feed/HistoryFeed';
import styles from './HistorySidebarContent.module.css';
import { useHistory } from './useHistory';

export function HistorySidebarContent({
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
    const history = useHistory(source);
    const scrollRoot = useRef<HTMLDivElement | null>(null);
    const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);
    const [returningToTop, setReturningToTop] = useState(false);
    const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [topTooltip, setTopTooltip] = useState(false);
    const { state } = history;
    const attachScrollRoot = useCallback((element: HTMLDivElement | null) => {
        scrollRoot.current = element;
        setScrollParent(element);
    }, []);

    useEffect(() => {
        if (!returningToTop) {
            return;
        }

        const root = scrollRoot.current;

        if (!root) {
            setReturningToTop(false);

            return;
        }

        const finish = () => setReturningToTop(false);

        const onScroll = () => {
            if (root.scrollTop <= 1) {
                finish();
            }
        };

        root.addEventListener('scroll', onScroll, { passive: true });
        root.addEventListener('scrollend', onScroll);
        root.addEventListener('wheel', finish, { passive: true });
        root.addEventListener('pointerdown', finish);
        root.addEventListener('keydown', finish);

        return () => {
            root.removeEventListener('scroll', onScroll);
            root.removeEventListener('scrollend', onScroll);
            root.removeEventListener('wheel', finish);
            root.removeEventListener('pointerdown', finish);
            root.removeEventListener('keydown', finish);
        };
    }, [returningToTop]);

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

    function handleHistoryKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const root = scrollRoot.current;

        if (!root || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }

        if (event.key === 'End') {
            event.preventDefault();
            root.scrollTo({ top: root.scrollHeight, behavior: 'auto' });
        } else if (event.key === 'Home') {
            event.preventDefault();
            root.scrollTo({ top: 0, behavior: 'auto' });
            history.showNewest();
        }
    }

    function handleReturnToTop() {
        const root = scrollRoot.current;

        if (root && root.scrollTop <= 1) {
            setTopTooltip(true);

            return;
        }

        setTopTooltip(false);
        setReturningToTop(true);
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        root?.scrollTo?.({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        history.showNewest();
    }

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <h2 id="history-heading">{t('history.title')}</h2>
            </div>
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
                            <HistoryFeed
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
