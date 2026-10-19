import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
    createHistorySearchSession,
    type HistorySearchSession,
} from '../../../features/user-history';

export function useDeviceEventHistory(deviceId: string) {
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

    useEffect(() => {
        const session = createHistorySearchSession();
        sessionRef.current = session;
        unsubscribeRef.current = session.subscribe(() => {
            for (const listener of listeners.current) {
                listener();
            }
        });
        void session.search({ deviceId });

        return () => {
            unsubscribeRef.current?.();
            unsubscribeRef.current = null;
            sessionRef.current = null;
            session.close();
        };
    }, [deviceId]);

    return {
        state,
        loadOlder: useCallback(() => sessionRef.current?.loadOlder() ?? Promise.resolve(), []),
        retry: useCallback(() => sessionRef.current?.retry() ?? Promise.resolve(), []),
        refresh: useCallback(() => sessionRef.current?.refresh() ?? Promise.resolve(), []),
    };
}
