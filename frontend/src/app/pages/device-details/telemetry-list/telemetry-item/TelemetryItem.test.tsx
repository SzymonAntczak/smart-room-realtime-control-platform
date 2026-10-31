import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { i18n } from '../../../../i18n';
import { formatTimestamp } from '../../../../shared/date-time';

import { TelemetryItem } from './TelemetryItem';

it('shows the full observation time, raw numeric precision and unit without a durable label', () => {
    const item = { ...createHistoryIdentityFixtures().telemetrySample, value: 21.123456789 };
    render(<TelemetryItem item={item} />);
    expect(screen.getByRole('article')).toHaveTextContent('21.123456789 °C');
    expect(screen.getByText(formatTimestamp(item.occurredAt))).toHaveAttribute(
        'datetime',
        item.occurredAt,
    );
    expect(
        screen.queryByText(i18n.t('telemetry.durability.durable', { ns: 'deviceDetails' })),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('marks a volatile measurement with a warning beside its value', () => {
    const item = {
        ...createHistoryIdentityFixtures().telemetrySample,
        durability: 'volatile',
    } as const;
    render(<TelemetryItem item={item} />);

    expect(screen.getByRole('status')).toHaveTextContent(
        i18n.t('telemetry.durability.volatile', { ns: 'deviceDetails' }),
    );
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'warning');
});
