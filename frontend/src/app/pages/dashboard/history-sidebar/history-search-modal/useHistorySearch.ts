import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
    createHistorySearchSession,
    type HistorySearchCriteria,
    type HistorySearchSession,
} from './history-search-session';

export function useHistorySearch() {
    const sessionRef = useRef<HistorySearchSession | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);
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

    const notify = useCallback(() => {
        for (const listener of listeners.current) {
            listener();
        }
    }, []);
    const close = useCallback(() => {
        const session = sessionRef.current;

        if (!session) {
            return;
        }

        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        sessionRef.current = null;
        session.close();
        notify();
    }, [notify]);
    const start = useCallback(() => {
        if (sessionRef.current) {
            return;
        }

        const session = createHistorySearchSession();
        sessionRef.current = session;
        unsubscribeRef.current = session.subscribe(notify);
        notify();
    }, [notify]);

    useEffect(() => {
        start();

        return close;
    }, [close, start]);

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

    return { state, search, loadOlder, retry, refresh, clear, start, close };
}
