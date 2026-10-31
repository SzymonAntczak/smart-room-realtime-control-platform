import { useCallback } from 'react';

import { useInfiniteSession } from '../../infinite-scrolling';

import { createHistorySearchSession, type HistorySearchCriteria } from './history-search-session';

export function useHistorySearch(enabled = true) {
    const { state, getSession } = useInfiniteSession(createHistorySearchSession, enabled);
    const search = useCallback(
        (criteria: HistorySearchCriteria) =>
            getSession()?.search(criteria) ?? Promise.resolve(false),
        [getSession],
    );
    const loadOlder = useCallback(
        () => getSession()?.loadOlder() ?? Promise.resolve(),
        [getSession],
    );
    const retry = useCallback(() => getSession()?.retry() ?? Promise.resolve(), [getSession]);
    const refresh = useCallback(() => getSession()?.refresh() ?? Promise.resolve(), [getSession]);
    const clear = useCallback(() => {
        getSession()?.clear();
    }, [getSession]);

    return { state, search, loadOlder, retry, refresh, clear };
}
