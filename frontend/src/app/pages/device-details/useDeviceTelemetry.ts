import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import { useRoomConnection } from '../../shared/room-realtime';

import { createTelemetrySession } from './telemetry-session';

export function useDeviceTelemetry(deviceId: string | undefined) {
    const { historySource } = useRoomConnection();
    const sessionRef = useRef<ReturnType<typeof createTelemetrySession> | null>(null);
    const listeners = useRef(new Set<() => void>());
    const subscribe = useCallback((listener: () => void) => {
        listeners.current.add(listener);

        return () => listeners.current.delete(listener);
    }, []);
    const getSnapshot = useCallback(() => {
        const state = sessionRef.current?.getState();

        return state && state.deviceId === deviceId ? state : null;
    }, [deviceId]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const notify = useCallback(() => {
        for (const listener of listeners.current) {
            listener();
        }
    }, []);

    useEffect(() => {
        if (deviceId === undefined) {
            return;
        }

        const session = createTelemetrySession(
            deviceId,
            undefined,
            undefined,
            historySource.requestBaseline,
        );
        sessionRef.current = session;
        const unsubscribe = session.subscribe(notify);
        const unsubscribeRealtime = historySource.subscribe(session.acceptRealtime);
        const baseline = historySource.getBaseline();

        if (baseline) {
            session.acceptRealtime(baseline);
        }

        void session.start();

        return () => {
            unsubscribeRealtime();
            unsubscribe();
            session.close();
            sessionRef.current = null;
            notify();
        };
    }, [deviceId, historySource, notify]);

    const retry = useCallback(() => {
        void sessionRef.current?.start();
    }, []);

    return { state, retry };
}
