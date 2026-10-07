import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type Components, Virtuoso } from 'react-virtuoso';

import type { RenderableDeviceProjection } from '../../../device-projection';
import type { HistoryFeedContext } from '../../history-sidebar-content/history-feed/history-feed-context';
import { HistoryFeedList } from '../../history-sidebar-content/history-feed/history-feed-list/HistoryFeedList';
import { HistoryFeedRow } from '../../history-sidebar-content/history-feed/history-feed-row/HistoryFeedRow';
import type { HistorySearchSession } from '../history-search-session';

import styles from './HistorySearchResults.module.css';

const components: Components<UserHistoryItem, HistoryFeedContext, HTMLUListElement> = {
    List: HistoryFeedList,
    Item: HistoryFeedRow,
};

type SearchState = ReturnType<HistorySearchSession['getState']>;

export function HistorySearchResults({
    state,
    devices,
    scrollParent,
    loadOlder,
    retry,
    refresh,
}: {
    state: SearchState;
    devices: readonly RenderableDeviceProjection[];
    scrollParent: HTMLElement | null;
    loadOlder(): Promise<void>;
    retry(): Promise<void>;
    refresh(): Promise<void>;
}) {
    const { t } = useTranslation('dashboard');
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
                <p className={styles.status} role="status">
                    {t('history.searchInstruction')}
                </p>
            ) : null}
            {state.status === 'loading' ? (
                <p className={styles.status} role="status">
                    <LoaderCircle aria-hidden="true" size={18} />
                    <span>{t('history.loading')}</span>
                </p>
            ) : null}
            {state.lastKnown ? (
                <p className={styles.notice} role="status">
                    {t('history.lastKnown')}
                </p>
            ) : null}
            {state.completeness === 'retained_evidence_only' ? (
                <p className={styles.notice} role="status">
                    {t('history.searchIncomplete')}
                </p>
            ) : null}
            {state.status === 'ready' && state.items.length === 0 && state.endReached ? (
                <p className={styles.status} role="status">
                    {t('history.noMatches')}
                </p>
            ) : null}
            {state.items.length > 0 && scrollParent ? (
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
                            : t(`history.errors.${state.error}`)}
                    </p>
                    <button
                        type="button"
                        onClick={() => void (state.refreshRequired ? refreshFromTop() : retry())}
                    >
                        {state.refreshRequired ? t('history.refresh') : t('history.retry')}
                    </button>
                </div>
            ) : null}
            {state.status === 'ready' && state.nextCursor !== null ? (
                <button
                    type="button"
                    className={styles.action}
                    disabled={state.limitReached}
                    onClick={() => void loadOlder()}
                >
                    {state.limitReached ? t('history.searchLimit') : t('history.loadOlder')}
                </button>
            ) : null}
            {state.endReached && state.items.length > 0 ? (
                <p className={styles.status} role="status">
                    {t('history.end')}
                </p>
            ) : null}
            {state.appliedCriteria && state.status !== 'error' ? (
                <button
                    type="button"
                    className={styles.action}
                    disabled={state.status === 'loading'}
                    onClick={refreshFromTop}
                >
                    <RefreshCw aria-hidden="true" size={16} />
                    {t('history.refresh')}
                </button>
            ) : null}
        </div>
    );
}
