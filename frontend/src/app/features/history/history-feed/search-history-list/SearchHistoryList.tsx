import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../ui';
import { getDeviceDisplayName } from '../../../device-display';
import { InfiniteList } from '../../../infinite-scrolling';
import type { HistoryDevice } from '../../history-context';
import { HistoryFeedItem } from '../history-feed-item/HistoryFeedItem';
import type { HistorySearchSession } from '../history-search-session';

import styles from './SearchHistoryList.module.css';

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
            {
                <InfiniteList
                    items={state.lastKnown || state.status === 'error' ? [] : state.items}
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
                                    device
                                        ? getDeviceDisplayName(device, (key) => t(key))
                                        : undefined
                                }
                            />
                        );
                    }}
                    scrollParent={scrollParent}
                    ariaLabel={t('history.searchResults')}
                    hasMore={
                        state.status === 'ready' &&
                        !state.error &&
                        state.nextCursor !== null &&
                        !state.limitReached
                    }
                    loading={state.status === 'loading'}
                    endReached={state.endReached}
                    onLoadMore={loadOlder}
                />
            }
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
                            : state.refreshRequired
                              ? t('refresh', { ns: 'deviceFilters' })
                              : t('history.retry')}
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
