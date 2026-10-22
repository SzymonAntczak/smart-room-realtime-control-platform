import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { i18n } from '../../../i18n';

import { TelemetryTable } from './TelemetryTable';

describe('TelemetryTable', () => {
    it('renders raw sample values using semantic column headers', () => {
        const { telemetrySample } = createHistoryIdentityFixtures();
        render(
            <TelemetryTable
                samples={[telemetrySample]}
                emptyMessage={i18n.t('telemetry.empty', { ns: 'deviceDetails' })}
            />,
        );

        const table = screen.getByRole('table', {
            name: i18n.t('table.caption', { ns: 'deviceDetails' }),
        });
        expect(
            within(table).getByRole('columnheader', {
                name: i18n.t('table.time', { ns: 'deviceDetails' }),
            }),
        ).toBeInTheDocument();
        expect(
            within(table).getByRole('columnheader', {
                name: i18n.t('table.value', { ns: 'deviceDetails' }),
            }),
        ).toBeInTheDocument();
        expect(
            within(table).getByRole('columnheader', {
                name: i18n.t('table.unit', { ns: 'deviceDetails' }),
            }),
        ).toBeInTheDocument();
        expect(within(table).getByRole('cell', { name: '22.5' })).toBeInTheDocument();
        expect(
            within(table).getByRole('cell', {
                name: i18n.t('temperatureUnit', { ns: 'deviceDetails' }),
            }),
        ).toBeInTheDocument();
    });

    it('keeps the table available and explains that its history is empty', () => {
        render(
            <TelemetryTable
                samples={[]}
                emptyMessage={i18n.t('telemetry.empty', { ns: 'deviceDetails' })}
            />,
        );

        expect(
            screen.getByRole('table', { name: i18n.t('table.caption', { ns: 'deviceDetails' }) }),
        ).toHaveTextContent(i18n.t('telemetry.empty', { ns: 'deviceDetails' }));
    });
});
