import { createContext, useContext } from 'react';

import type { useDeviceFilterForm } from './useDeviceFilterForm';

export const DeviceFiltersContext = createContext<
    (ReturnType<typeof useDeviceFilterForm> & { fixedDeviceId?: string }) | null
>(null);

export function useDeviceFilters() {
    const context = useContext(DeviceFiltersContext);

    if (!context) {
        throw new Error('DeviceFilters requires DeviceFiltersProvider');
    }

    return context;
}
