import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';

import { useDeviceFilters } from './device-filters-context';

it('requires a local provider', () => {
    expect(() => renderHook(useDeviceFilters)).toThrow(
        'DeviceFilters requires DeviceFiltersProvider',
    );
});
