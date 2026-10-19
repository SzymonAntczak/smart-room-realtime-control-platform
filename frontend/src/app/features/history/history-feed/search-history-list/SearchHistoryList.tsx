import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type Components, Virtuoso } from 'react-virtuoso';

import { Button } from '../../../../ui';
import type { HistoryDevice } from '../../history-context';
import type { HistoryFeedContext } from '../history-feed-context';
import { HistoryFeedList } from '../history-feed-list/HistoryFeedList';
import { HistoryFeedRow } from '../history-feed-row/HistoryFeedRow';
import type { HistorySearchSession } from '../history-search-session';

import styles from './SearchHistoryList.module.css';

const components: Components<UserHistoryItem, HistoryFeedContext, HTMLUListElement> = {
    List: HistoryFeedList,
    Item: HistoryFeedRow,
};

type SearchState = ReturnType<HistorySearchSession['getState']>;

export function SearchHistoryList({
    state,
    devices,
    scrollParent,
    loadOlder,
    retry,
    refresh,
    deviceScoped = false,
}: {
    state: SearchState;
    devices: readonly HistoryDevice[];
    scrollParent: HTMLElement | null;
    loadOlder(): Promise<void>;
    retry(): Promise<void>;
    refresh(): Promise<void>;
    deviceScoped?: boolean;
}) {
    const { t } = useTranslation('dashboard');
    const { t: deviceT } = useTranslation('deviceDetails');
    const context: HistoryFeedContext = {
        devices,
        endReached: state.endReached,
        totalItems: state.items.length,
    };

    function refreshFromTop() {
        if (scrollParent) {
            scrollParent.scrollTo?.({ top: 0, behavior: 'auto' });
        }

        void refresh();
    }

    return (
        <div className={styles.results}>
            {state.status === 'idle' ? (
                <p className={`${styles.status} ${styles.instruction}`} role="status">
                    {t('history.searchInstruction')}
                </p>
            ) : null}
            {state.status === 'loading' ? (
                <p className={styles.status} role="status">
                    <LoaderCircle aria-hidden="true" size={18} />
                    <span>{t('history.loading')}</span>
                </p>
            ) : null}
            {state.status === 'ready' && state.items.length === 0 && state.endReached ? (
                <p className={styles.status} role="status">
                    {deviceScoped ? deviceT('eventHistory.empty') : t('history.noMatches')}
                </p>
            ) : null}
            {state.items.length > 0 && scrollParent && !state.lastKnown ? (
                <Virtuoso
                    data={state.items}
                    customScrollParent={scrollParent}
                    components={components}
                    context={context}
                    computeItemKey={(_index, item) => item.recordId}
                    defaultItemHeight={192}
                    minOverscanItemCount={{ top: 5, bottom: 5 }}
                    endReached={() => {
                        if (state.status === 'ready' && state.nextCursor !== null) {
                            void loadOlder();
                        }
                    }}
                    itemContent={() => null}
                />
            ) : null}
            {state.status === 'error' ? (
                <div className={styles.error} role="alert">
                    <p>
                        {state.error === 'history_limit_reached'
                            ? t('history.searchLimit')
                            : deviceScoped
                              ? deviceT(`eventHistory.errors.${state.error}`, {
                                    defaultValue: deviceT('eventHistory.error'),
                                })
                              : t(`history.errors.${state.error}`)}
                    </p>
                    <Button
                        variant="outlined"
                        type="button"
                        onClick={() => void (state.refreshRequired ? refreshFromTop() : retry())}
                    >
                        {deviceScoped
                            ? deviceT(
                                  state.refreshRequired
                                      ? 'eventHistory.refresh'
                                      : 'eventHistory.retry',
                              )
                            : t(state.refreshRequired ? 'history.refresh' : 'history.retry')}
                    </Button>
                </div>
            ) : null}
            {!deviceScoped &&
            state.status === 'ready' &&
            state.nextCursor !== null &&
            !state.limitReached ? (
                <Button
                    variant="outlined"
                    type="button"
                    className={styles.action}
                    onClick={() => void loadOlder()}
                >
                    {t('history.loadOlder')}
                </Button>
            ) : null}
            {state.status === 'ready' && state.endReached && state.items.length > 0 ? (
                <p className={styles.status} role="status">
                    {deviceScoped ? deviceT('eventHistory.end') : t('history.end')}
                </p>
            ) : null}
            {state.status === 'ready' && state.limitReached ? (
                <p className={styles.status} role="status">
                    {deviceScoped ? deviceT('eventHistory.limit') : t('history.searchLimit')}
                </p>
            ) : null}
        </div>
    );
}
