import type { ReactNode } from 'react';

import { DeviceFiltersContext } from './device-filters-context';
import { useDeviceFilterForm } from './useDeviceFilterForm';

type Props = Parameters<typeof useDeviceFilterForm>[0] & { children: ReactNode };

export function DeviceFiltersProvider({ children, ...props }: Props) {
    const form = useDeviceFilterForm(props);

    return (
        <DeviceFiltersContext value={{ ...form, fixedDeviceId: props.fixedDeviceId }}>
            {children}
        </DeviceFiltersContext>
    );
}
