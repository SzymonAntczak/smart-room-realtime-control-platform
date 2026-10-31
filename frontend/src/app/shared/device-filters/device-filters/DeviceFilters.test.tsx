import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { i18n } from '../../../i18n';
import { DeviceFiltersProvider } from '../DeviceFiltersProvider';

import { DeviceFilters } from './DeviceFilters';

it('keeps sibling criteria independent and distinguishes draft, applied, refresh and clear', () => {
    const apply = vi.fn();
    const refresh = vi.fn();
    const clear = vi.fn();
    render(
        <>
            <section aria-label="First">
                <DeviceFiltersProvider
                    devices={[]}
                    fixedDeviceId="sensor"
                    onApply={apply}
                    onRefresh={refresh}
                    onClear={clear}
                >
                    <DeviceFilters />
                </DeviceFiltersProvider>
            </section>
            <section aria-label="Second">
                <DeviceFiltersProvider
                    devices={[]}
                    onApply={vi.fn()}
                    onRefresh={vi.fn()}
                    onClear={vi.fn()}
                >
                    <DeviceFilters />
                </DeviceFiltersProvider>
            </section>
        </>,
    );
    const first = within(screen.getByRole('region', { name: 'First' }));
    const second = within(screen.getByRole('region', { name: 'Second' }));
    const from = i18n.t('from', { ns: 'deviceFilters' });
    fireEvent.change(first.getByLabelText(from), { target: { value: '2026-10-20' } });
    expect(apply).not.toHaveBeenCalled();
    expect(second.getByLabelText(from)).toHaveValue('');
    fireEvent.click(first.getByRole('button', { name: i18n.t('search', { ns: 'deviceFilters' }) }));
    expect(apply).toHaveBeenCalledWith({
        deviceId: 'sensor',
        from: new Date(2026, 9, 20).toISOString(),
    });
    fireEvent.change(first.getByLabelText(from), { target: { value: '2026-10-21' } });
    fireEvent.click(
        first.getByRole('button', { name: i18n.t('refresh', { ns: 'deviceFilters' }) }),
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
    fireEvent.click(
        first.getByRole('button', { name: i18n.t('clearFilters', { ns: 'deviceFilters' }) }),
    );
    expect(clear).toHaveBeenCalledOnce();
    expect(first.getByLabelText(from)).toHaveValue('');
});
