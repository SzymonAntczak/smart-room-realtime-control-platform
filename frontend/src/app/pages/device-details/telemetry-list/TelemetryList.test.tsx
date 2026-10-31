import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { i18n } from '../../../i18n';

import { TelemetryList } from './TelemetryList';

afterEach(() => vi.unstubAllGlobals());
it('labels its static scope and blocks an invalid effective range without HTTP', async () => {
    const page = {
        ...createHistoryIdentityFixtures().rawTelemetryPage,
        pageSize: 100,
        items: [],
        nextCursor: null,
    };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(page)));
    vi.stubGlobal('fetch', fetcher);
    render(<TelemetryList device={{ deviceId: 'temp-desk', name: 'Sensor' }} />);
    const list = screen.getByRole('region', {
        name: i18n.t('telemetryList.scrollRegion', { ns: 'deviceDetails' }),
    });
    await within(list).findByText(i18n.t('telemetry.empty', { ns: 'deviceDetails' }));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.change(screen.getByLabelText(i18n.t('from', { ns: 'deviceFilters' })), {
        target: { value: '2099-01-01' },
    });
    fireEvent.click(
        screen.getByRole('button', { name: i18n.t('search', { ns: 'deviceFilters' }) }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
        i18n.t('invalidDateRange', { ns: 'deviceFilters' }),
    );
    expect(fetcher).toHaveBeenCalledOnce();
});
