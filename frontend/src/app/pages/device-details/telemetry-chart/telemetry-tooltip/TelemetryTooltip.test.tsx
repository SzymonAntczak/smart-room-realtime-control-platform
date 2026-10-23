import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatTimestamp } from '../../../../features/date-time';
import { i18n } from '../../../../i18n';

import { TelemetryTooltip } from './TelemetryTooltip';

describe('TelemetryTooltip', () => {
    it('does not invent a measurement without an active sample', () => {
        render(<TelemetryTooltip samples={[]} />);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('shows exact values and durability for every sample in input order', () => {
        const sample = createHistoryIdentityFixtures().telemetrySample;
        render(
            <TelemetryTooltip
                samples={[
                    sample,
                    {
                        recordId: `rec:v1:sha256:${'c'.repeat(64)}`,
                        deviceId: sample.deviceId,
                        metric: sample.metric,
                        unit: sample.unit,
                        occurredAt: sample.occurredAt,
                        value: 23.125,
                        durability: 'volatile',
                    },
                ]}
            />,
        );
        const tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent(formatTimestamp(sample.occurredAt));
        const entries = within(tooltip).getAllByRole('listitem');
        expect(entries[0]).toHaveTextContent(
            `22.5 ${i18n.t('temperatureUnit', { ns: 'deviceDetails' })}`,
        );
        expect(entries[0]).toHaveTextContent(
            i18n.t('telemetry.durability.durable', { ns: 'deviceDetails' }),
        );
        expect(entries[1]).toHaveTextContent('23.125');
        expect(entries[1]).toHaveTextContent(
            i18n.t('telemetry.durability.volatile', { ns: 'deviceDetails' }),
        );
    });
});
