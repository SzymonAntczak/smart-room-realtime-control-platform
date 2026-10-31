import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { useDeviceFilters } from './device-filters-context';
import { DeviceFiltersProvider } from './DeviceFiltersProvider';

it('initializes fixed-device applied criteria without starting transport', () => {
    const apply = vi.fn();
    const { result } = renderHook(useDeviceFilters, {
        wrapper: ({ children }) => (
            <DeviceFiltersProvider
                devices={[]}
                fixedDeviceId="sensor"
                onApply={apply}
                onRefresh={vi.fn()}
                onClear={vi.fn()}
            >
                {children}
            </DeviceFiltersProvider>
        ),
    });
    expect(result.current.appliedForm).toEqual({ deviceId: 'sensor', from: '', to: '' });
    expect(apply).not.toHaveBeenCalled();
});
