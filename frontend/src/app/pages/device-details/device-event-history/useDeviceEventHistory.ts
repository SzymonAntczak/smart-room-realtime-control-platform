import { useEffect } from 'react';

import { useHistorySearch } from '../../../shared/history';

export function useDeviceEventHistory(deviceId: string) {
    const search = useHistorySearch();
    const runSearch = search.search;
    useEffect(() => {
        void runSearch({ deviceId });
    }, [deviceId, runSearch]);

    return search;
}
