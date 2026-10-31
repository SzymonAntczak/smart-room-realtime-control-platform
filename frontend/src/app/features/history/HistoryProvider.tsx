import { type ReactNode, useEffect } from 'react';

import { DeviceFiltersProvider } from '../device-filters';

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
    | { mode: 'search'; fixedDeviceId?: string }
);

export function HistoryProvider(props: HistoryProviderProps) {
    const history = useHistory(props.mode === 'live' ? props.source : undefined);
    const search = useHistorySearch(props.mode === 'search');
    const fixedDeviceId = props.mode === 'search' ? (props.fixedDeviceId ?? null) : null;
    const runSearch = search.search;
    useEffect(() => {
        if (fixedDeviceId) {
            void runSearch({ deviceId: fixedDeviceId });
        }
    }, [fixedDeviceId, runSearch]);
    const value: HistoryContextValue =
        props.mode === 'live'
            ? {
                  mode: 'live',
                  devices: props.devices,
                  history,
                  waitingForRoom: props.waitingForRoom,
                  realtimeUncertain: props.realtimeUncertain,
              }
            : { mode: 'search', devices: props.devices, search, fixedDeviceId };

    return (
        <HistoryContext value={value}>
            {props.mode === 'search' ? (
                <DeviceFiltersProvider
                    devices={props.devices}
                    fixedDeviceId={props.fixedDeviceId}
                    onApply={(criteria) => {
                        void search.search(criteria);
                    }}
                    onRefresh={() => {
                        void search.refresh();
                    }}
                    onClear={() => {
                        if (fixedDeviceId) {
                            void search.search({ deviceId: fixedDeviceId });
                        } else {
                            search.clear();
                        }
                    }}
                >
                    {props.children}
                </DeviceFiltersProvider>
            ) : (
                props.children
            )}
        </HistoryContext>
    );
}
