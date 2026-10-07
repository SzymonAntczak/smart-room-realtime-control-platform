import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { RoomHistorySource } from '../../room-history-source';

import {
    createHistorySession,
    type HistoryReadingPosition,
    type HistorySession,
} from './history-session';

export function useHistory(source: RoomHistorySource) {
    const sessionRef = useRef<HistorySession | null>(null);
    const listeners = useRef(new Set<() => void>());
    const [initialState] = useState(() => createHistorySession().getState());
    const subscribe = useCallback((listener: () => void) => {
        listeners.current.add(listener);

        return () => {
            listeners.current.delete(listener);
        };
    }, []);
    const getSnapshot = useCallback(
        () => sessionRef.current?.getState() ?? initialState,
        [initialState],
    );
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const loadOlder = useCallback(() => {
        void sessionRef.current?.loadNextPage();
    }, []);

    useEffect(() => {
        const session = createHistorySession(undefined, source.requestBaseline);
        sessionRef.current = session;

        const notify = () => {
            for (const listener of listeners.current) {
                listener();
            }
        };

        const unsubscribeState = session.subscribe(notify);
        const unsubscribeRealtime = source.subscribe((update) => {
            session.acceptRealtime(update);

            if (session.getState().status === 'idle') {
                void session.loadNextPage();
            }
        });
        const baseline = source.getBaseline();

        if (baseline) {
            session.acceptRealtime(baseline);
            void session.loadNextPage();
        } else {
            notify();
        }

        return () => {
            unsubscribeRealtime();
            unsubscribeState();
            session.close();

            if (sessionRef.current === session) {
                sessionRef.current = null;
            }
        };
    }, [source]);

    return {
        state,
        loadOlder,
        retry: () => {
            void sessionRef.current?.retry();
        },
        showNewest: () => {
            void sessionRef.current?.refreshToNewest();
        },
        updateReadingPosition: useCallback((position: HistoryReadingPosition | null) => {
            sessionRef.current?.updateReadingPosition(position);
        }, []),
    };
}
