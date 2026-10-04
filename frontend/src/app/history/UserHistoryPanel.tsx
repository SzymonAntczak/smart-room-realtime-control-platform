import { type RefObject, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { RoomHistorySource } from '../realtime/room-history-source';
import type { RenderableDeviceProjection } from '../shared/room-rendering';

import { RecentEventsFeed } from './RecentEventsFeed';
import { useUserHistory } from './use-user-history';
import styles from './UserHistoryPanel.module.css';

export function UserHistoryPanel({
    source,
    scrollRoot,
    devices,
    realtimeUncertain,
}: {
    source: RoomHistorySource;
    scrollRoot: RefObject<HTMLElement | null>;
    devices: readonly RenderableDeviceProjection[];
    realtimeUncertain: boolean;
}) {
    const { t } = useTranslation('dashboard');
    const history = useUserHistory(source);
    const header = useRef<HTMLDivElement | null>(null);
    const { state } = history;

    return (
        <div className={styles.panel}>
            <div
                className={styles.header}
                ref={header}
                role="group"
                aria-label={t('history.navigation')}
            >
                <p>{t('history.completeness')}</p>
                {state.lastKnown ? <p role="status">{t('history.lastKnown')}</p> : null}
                {state.notice ? <p role="status">{t(`history.${state.notice}`)}</p> : null}
                {state.overlayOverflow ? <p>{t('history.overflow')}</p> : null}
                {state.hasNewEvents || state.position !== null || state.overlayOverflow ? (
                    <button type="button" onClick={history.showNewest}>
                        {t('history.newEvents')}
                    </button>
                ) : null}
            </div>
            <RecentEventsFeed
                state={state}
                devices={devices}
                realtimeUncertain={realtimeUncertain}
                scrollRoot={scrollRoot}
                header={header}
                updateReadingPosition={history.updateReadingPosition}
                loadOlder={history.loadOlder}
            />
            <div className={styles.status}>
                {state.status === 'loading' || state.status === 'waiting_for_baseline' ? (
                    <p role="status">{t('history.loading')}</p>
                ) : null}
                {state.error ? (
                    <div role="alert">
                        <p>{t(`history.errors.${state.error}`)}</p>
                        <button type="button" onClick={history.retry}>
                            {t('history.retry')}
                        </button>
                    </div>
                ) : null}
                {state.endReached ? <p role="status">{t('history.end')}</p> : null}
                {!state.endReached && !state.error ? (
                    <button
                        type="button"
                        onClick={history.loadOlder}
                        disabled={state.status !== 'ready' && state.status !== 'idle'}
                    >
                        {t('history.loadOlder')}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
