import { useCallback, useEffect } from 'react';

import type { DeviceFilterCriteria } from '../../../features/device-filters';
import { useInfiniteSession } from '../../../features/infinite-scrolling';
import { createTelemetrySearchSession, resolveTelemetryRange } from '../telemetry-search-session';

export function useTelemetryList(deviceId: string) {
    const createSession = useCallback(() => createTelemetrySearchSession(deviceId), [deviceId]);
    const { state, getSession } = useInfiniteSession(createSession);
    const search = useCallback(
        (criteria: DeviceFilterCriteria) => {
            void getSession()?.search(criteria);
        },
        [getSession],
    );
    const clear = useCallback(() => search({ deviceId }), [deviceId, search]);
    const refresh = useCallback(() => getSession()?.refresh() ?? Promise.resolve(), [getSession]);
    const retry = useCallback(() => getSession()?.retry() ?? Promise.resolve(), [getSession]);
    const loadMore = useCallback(() => getSession()?.loadMore() ?? Promise.resolve(), [getSession]);
    useEffect(clear, [clear]);

    return {
        state,
        search,
        clear,
        refresh,
        retry,
        loadMore,
        validate: (criteria: DeviceFilterCriteria) =>
            resolveTelemetryRange(criteria, Date.now()) !== null,
    };
}
