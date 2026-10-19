import type { Ref } from 'react';

import { useHistoryContext } from '../history-context';

import type { HistoryFeedHandle } from './history-feed-handle';
import { LiveHistoryFeed } from './live-history-feed/LiveHistoryFeed';
import { SearchHistoryFeed } from './search-history-feed/SearchHistoryFeed';

export function HistoryFeed({ ref }: { ref?: Ref<HistoryFeedHandle> }) {
    const context = useHistoryContext();

    return context.mode === 'live' ? (
        <LiveHistoryFeed ref={ref} />
    ) : (
        <SearchHistoryFeed ref={ref} />
    );
}
