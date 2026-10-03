import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { RoomHistorySource } from '../realtime/room-history-source';

import { createUserHistorySession, type UserHistorySession } from './user-history-session';

export function useUserHistory(
    source: RoomHistorySource,
    scrollRoot: RefObject<HTMLElement | null>,
) {
    const sessionRef = useRef<UserHistorySession | null>(null);
    const entries = useRef(new Map<string, HTMLElement>());
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

    useLayoutEffect(() => {
        const root = scrollRoot.current;

        if (!root) {
            return;
        }

        if (state.position === null) {
            root.scrollTop = 0;
        } else {
            const entry = entries.current.get(state.position.recordId);

            if (entry) {
                root.scrollTop +=
                    entry.getBoundingClientRect().top -
                    root.getBoundingClientRect().top -
                    state.position.offsetPx;
            }
        }
    }, [state, scrollRoot]);

    useEffect(() => {
        const root = scrollRoot.current;

        if (!root) {
            return;
        }

        const onScroll = () => {
            const session = sessionRef.current;

            if (!session || session.getState().status === 'closed') {
                return;
            }

            const top = root.getBoundingClientRect().top;
            const first = state.items.find((item) => {
                const entry = entries.current.get(item.recordId);

                return entry && entry.getBoundingClientRect().bottom > top;
            });
            const entry = first ? entries.current.get(first.recordId) : undefined;
            session.updateReadingPosition(
                root.scrollTop <= 1 || !first || !entry
                    ? null
                    : {
                          recordId: first.recordId,
                          occurredAt: first.occurredAt,
                          offsetPx: entry.getBoundingClientRect().top - top,
                      },
            );

            if (root.scrollHeight - root.scrollTop - root.clientHeight <= root.clientHeight) {
                loadOlder();
            }
        };

        root.addEventListener('scroll', onScroll);

        return () => root.removeEventListener('scroll', onScroll);
    }, [state.items, scrollRoot, loadOlder]);

    // Sparse pages and short initial lists must also advance without a scroll event.
    useEffect(() => {
        const root = scrollRoot.current;

        if (
            state.status === 'ready' &&
            !state.endReached &&
            root &&
            root.clientHeight > 0 &&
            root.scrollHeight - root.scrollTop - root.clientHeight <= root.clientHeight
        ) {
            loadOlder();
        }
    }, [state, scrollRoot, loadOlder]);

    return {
        state,
        loadOlder,
        retry: () => {
            void sessionRef.current?.retry();
        },
        showNewest: () => {
            void sessionRef.current?.refreshToNewest();
        },
        registerEntry: (recordId: string, element: HTMLElement | null) => {
            if (element) {
                entries.current.set(recordId, element);
            } else {
                entries.current.delete(recordId);
            }
        },
    };
}
