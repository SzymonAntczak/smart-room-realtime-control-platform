import { expect, it } from 'vitest';

import { toDeviceFilterCriteria } from './device-filter-criteria';

it('omits empty criteria and converts inclusive local calendar days to half-open UTC bounds', () => {
    expect(toDeviceFilterCriteria({ deviceId: '', from: '', to: '' })).toBeNull();
    expect(
        toDeviceFilterCriteria({ deviceId: 'sensor', from: '2026-10-25', to: '2026-10-25' }),
    ).toEqual({
        deviceId: 'sensor',
        from: new Date(2026, 9, 25).toISOString(),
        to: new Date(2026, 9, 26).toISOString(),
    });
    expect(toDeviceFilterCriteria({ deviceId: '', from: '', to: '2026-10-25' })).toEqual({
        to: new Date(2026, 9, 26).toISOString(),
    });
});
