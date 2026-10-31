import { createContext, useContext } from 'react';

import type { useHistory } from './history-feed/useHistory';
import type { useHistorySearch } from './history-feed/useHistorySearch';

export interface HistoryDevice {
    deviceId: string;
    name: string;
}
interface HistoryContextBase {
    devices: readonly HistoryDevice[];
}
export type HistoryContextValue = HistoryContextBase &
    (
        | {
              mode: 'live';
              history: ReturnType<typeof useHistory>;
              waitingForRoom: boolean;
              realtimeUncertain: boolean;
          }
        | {
              mode: 'search';
              search: ReturnType<typeof useHistorySearch>;
              fixedDeviceId: string | null;
          }
    );
export const HistoryContext = createContext<HistoryContextValue | null>(null);

export function useHistoryContext() {
    const context = useContext(HistoryContext);

    if (!context) {
        throw new Error('History components require HistoryProvider');
    }

    return context;
}
