import { type Ref, useCallback, useImperativeHandle, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHistoryContext } from '../../history-context';
import type { HistoryFeedHandle } from '../history-feed-handle';
import { SearchHistoryList } from '../search-history-list/SearchHistoryList';

import styles from './SearchHistoryFeed.module.css';

export function SearchHistoryFeed({ ref }: { ref?: Ref<HistoryFeedHandle> }) {
    const context = useHistoryContext();

    if (context.mode !== 'search') {
        throw new Error('SearchHistoryFeed requires search mode');
    }

    const { search, devices, fixedDeviceId } = context;
    const { t } = useTranslation(['dashboard', 'deviceDetails']);
    const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);
    const attachScrollParent = useCallback(
        (element: HTMLDivElement | null) => setScrollParent(element),
        [],
    );
    useImperativeHandle(
        ref,
        () => ({
            scrollToTop() {
                const alreadyAtTop = !scrollParent || scrollParent.scrollTop <= 1;

                if (!alreadyAtTop) {
                    scrollParent?.scrollTo?.({ top: 0, behavior: 'auto' });
                }

                return { alreadyAtTop };
            },
        }),
        [scrollParent],
    );
    useLayoutEffect(() => {
        scrollParent?.scrollTo?.({ top: 0, behavior: 'auto' });
    }, [scrollParent, search.state.sessionRevision]);

    return (
        <div
            className={fixedDeviceId ? styles.deviceResults : styles.results}
            ref={attachScrollParent}
            role="region"
            aria-label={
                fixedDeviceId
                    ? t('eventHistory.scrollRegion', { ns: 'deviceDetails' })
                    : t('history.searchResults')
            }
            data-testid={fixedDeviceId ? 'device-event-history-scroll' : undefined}
            tabIndex={0}
        >
            <SearchHistoryList
                state={search.state}
                devices={devices}
                scrollParent={scrollParent}
                loadOlder={search.loadOlder}
                retry={search.retry}
                refresh={search.refresh}
                deviceScoped={fixedDeviceId !== null}
            />
        </div>
    );
}
