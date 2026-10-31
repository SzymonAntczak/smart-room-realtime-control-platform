import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

interface Session<S> {
    getState(): S;
    subscribe(listener: () => void): () => void;
    close(): void;
}

/** Lazily opens a local session, including events before the mount effect. */
export function useInfiniteSession<S, T extends Session<S>>(
    createSession: () => T,
    enabled = true,
) {
    const sessionRef = useRef<T | null>(null);
    const unsubscribe = useRef<(() => void) | null>(null);
    const listeners = useRef(new Set<() => void>());
    const [initialState] = useState(() => createSession().getState());
    const notify = useCallback(() => {
        for (const listener of listeners.current) {
            listener();
        }
    }, []);
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
    const getSession = useCallback(() => {
        if (!enabled) {
            return null;
        }

        if (!sessionRef.current) {
            const session = createSession();
            sessionRef.current = session;
            unsubscribe.current = session.subscribe(notify);
            notify();
        }

        return sessionRef.current;
    }, [createSession, enabled, notify]);
    useEffect(() => {
        getSession();

        return () => {
            unsubscribe.current?.();
            unsubscribe.current = null;
            sessionRef.current?.close();
            sessionRef.current = null;
            notify();
        };
    }, [getSession, notify]);

    return { state: state as ReturnType<T['getState']>, getSession };
}
