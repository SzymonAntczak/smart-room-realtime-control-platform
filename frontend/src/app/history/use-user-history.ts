import { useCallback, useEffect, useRef, useState } from 'react';

import type { RoomHistorySource } from '../realtime/room-history-source';

import {
    createUserHistorySession,
    type UserHistoryReadingPosition,
    type UserHistorySession,
} from './user-history-session';

export function useUserHistory(source: RoomHistorySource) {
    const sessionRef = useRef<UserHistorySession | null>(null);
    const [state, setState] = useState(() => createUserHistorySession().getState());
    const loadOlder = useCallback(() => {
        void sessionRef.current?.loadNextPage();
    }, []);

    useEffect(() => {
        const session = createUserHistorySession(fetch, source.requestBaseline);
        sessionRef.current = session;
        const unsubscribeState = session.subscribe(() => setState(session.getState()));
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
            setState(session.getState());
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
        updateReadingPosition: useCallback((position: UserHistoryReadingPosition | null) => {
            sessionRef.current?.updateReadingPosition(position);
        }, []),
    };
}
