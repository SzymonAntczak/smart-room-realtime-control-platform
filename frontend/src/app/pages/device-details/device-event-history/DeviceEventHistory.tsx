import { DeviceFilters, DeviceFiltersProvider } from '../../../shared/device-filters';
import { HistoryResults } from '../../../shared/history';

import { useDeviceEventHistory } from './useDeviceEventHistory';

export function DeviceEventHistory({ device }: { device: { deviceId: string; name: string } }) {
    const deviceId = device.deviceId;
    const search = useDeviceEventHistory(deviceId);

    return (
        <DeviceFiltersProvider
            devices={[device]}
            fixedDeviceId={deviceId}
            onApply={(criteria) => {
                void search.search({ ...criteria, deviceId });
            }}
            onRefresh={() => {
                void search.refresh();
            }}
            onClear={() => {
                void search.search({ deviceId });
            }}
        >
            <DeviceFilters />
            <HistoryResults {...search} devices={[device]} deviceScoped />
        </DeviceFiltersProvider>
    );
}
