import { type ReactNode, useState } from 'react';

import { HistoryContext, type HistoryContextValue, type HistoryDevice } from './history-context';
import { useHistory } from './history-feed/useHistory';
import { useHistorySearch } from './history-feed/useHistorySearch';
import type { HistoryLiveSource } from './history-live-source';

type HistoryProviderProps = { devices: readonly HistoryDevice[]; children: ReactNode } & (
    | {
          mode: 'live';
          source: HistoryLiveSource;
          waitingForRoom: boolean;
          realtimeUncertain: boolean;
      }
    | { mode: 'search' }
);

export function HistoryProvider(props: HistoryProviderProps) {
    const history = useHistory(props.mode === 'live' ? props.source : undefined);
    const search = useHistorySearch(props.mode === 'search');
    const [fixedDeviceId, setFixedDeviceId] = useState<string | null>(null);
    const value: HistoryContextValue =
        props.mode === 'live'
            ? {
                  mode: 'live',
                  devices: props.devices,
                  history,
                  waitingForRoom: props.waitingForRoom,
                  realtimeUncertain: props.realtimeUncertain,
              }
            : { mode: 'search', devices: props.devices, search, fixedDeviceId, setFixedDeviceId };

    return <HistoryContext value={value}>{props.children}</HistoryContext>;
}
