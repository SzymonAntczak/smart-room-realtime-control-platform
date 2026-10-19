import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type Components, Virtuoso } from 'react-virtuoso';

import { HistoryFeedList, type HistorySearchState } from '../../../features/user-history';
import { Button } from '../../../ui';

import type { EventHistoryContext } from './event-history-context';
import styles from './EventHistory.module.css';
import { HistoryRow } from './history-row/HistoryRow';
import { HistoryScroller } from './history-scroller/HistoryScroller';
import { useDeviceEventHistory } from './useDeviceEventHistory';

export function EventHistory({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
    const { t } = useTranslation('deviceDetails');
    const { state, loadOlder, retry, refresh } = useDeviceEventHistory(deviceId);
    const context: EventHistoryContext = {
        deviceName,
        endReached: state.endReached,
        totalItems: state.items.length,
        scrollLabel: t('eventHistory.scrollRegion'),
        endMessage:
            state.status === 'ready' && state.endReached && state.items.length > 0
                ? t('eventHistory.end')
                : null,
    };

    return (
        <section className={styles.panel} aria-labelledby="event-history-title">
            <h2 id="event-history-title">{t('eventHistory.title')}</h2>
            <p>{t('eventHistory.completeness')}</p>
            {state.status === 'idle' || state.status === 'loading' ? (
                <p className={styles.status} role="status">
                    <LoaderCircle aria-hidden="true" size={18} />
                    <span>{t('eventHistory.loading')}</span>
                </p>
            ) : null}
            {state.status === 'error' ? (
                <div className={styles.error} role="alert">
                    <p>{historyErrorMessage(t, state)}</p>
                    <Button
                        variant="outlined"
                        type="button"
                        onClick={() => void (state.refreshRequired ? refresh() : retry())}
                    >
                        {state.refreshRequired
                            ? t('eventHistory.refresh')
                            : t('eventHistory.retry')}
                    </Button>
                </div>
            ) : null}
            {state.status === 'ready' && state.items.length === 0 && state.endReached ? (
                <p className={styles.status} role="status">
                    {t('eventHistory.empty')}
                </p>
            ) : null}
            {state.items.length > 0 ? (
                <Virtuoso
                    data={state.items}
                    components={components}
                    context={context}
                    computeItemKey={(_index, item) => item.recordId}
                    defaultItemHeight={192}
                    minOverscanItemCount={{ top: 5, bottom: 5 }}
                    style={{ height: 'min(70dvh, 48rem)', minHeight: '22rem' }}
                    endReached={() => {
                        if (state.status === 'ready' && state.nextCursor !== null) {
                            void loadOlder();
                        }
                    }}
                    itemContent={() => null}
                />
            ) : null}
            {state.status === 'ready' && state.limitReached ? (
                <p className={styles.status} role="status">
                    {t('eventHistory.limit')}
                </p>
            ) : null}
        </section>
    );
}

const components: Components<UserHistoryItem, EventHistoryContext, HTMLOListElement> = {
    List: HistoryFeedList,
    Item: HistoryRow,
    Scroller: HistoryScroller,
};

function historyErrorMessage(t: ReturnType<typeof useTranslation>['t'], state: HistorySearchState) {
    if (state.error === null) {
        return t('eventHistory.error');
    }

    return t(`eventHistory.errors.${state.error}`, { defaultValue: t('eventHistory.error') });
}
