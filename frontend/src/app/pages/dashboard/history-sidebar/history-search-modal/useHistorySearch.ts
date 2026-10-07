import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
    createHistorySearchSession,
    type HistorySearchCriteria,
    type HistorySearchSession,
} from './history-search-session';

export function useHistorySearch() {
    const sessionRef = useRef<HistorySearchSession | null>(null);
    const listeners = useRef(new Set<() => void>());
    const [initialState] = useState(() => createHistorySearchSession().getState());
    const subscribe = useCallback((listener: () => void) => {
        listeners.current.add(listener);

        return () => listeners.current.delete(listener);
    }, []);
    const getSnapshot = useCallback(
        () => sessionRef.current?.getState() ?? initialState,
        [initialState],
    );
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    useEffect(() => {
        const session = createHistorySearchSession();
        sessionRef.current = session;

        const notify = () => {
            for (const listener of listeners.current) {
                listener();
            }
        };

        const unsubscribe = session.subscribe(notify);
        notify();

        return () => {
            unsubscribe();
            session.close();

            if (sessionRef.current === session) {
                sessionRef.current = null;
            }
        };
    }, []);

    const search = useCallback((criteria: HistorySearchCriteria) => {
        return sessionRef.current?.search(criteria) ?? Promise.resolve(false);
    }, []);
    const loadOlder = useCallback(() => {
        return sessionRef.current?.loadOlder() ?? Promise.resolve();
    }, []);
    const retry = useCallback(() => {
        return sessionRef.current?.retry() ?? Promise.resolve();
    }, []);
    const refresh = useCallback(() => {
        return sessionRef.current?.refresh() ?? Promise.resolve();
    }, []);
    const clear = useCallback(() => {
        sessionRef.current?.clear();
    }, []);

    return { state, search, loadOlder, retry, refresh, clear };
}
