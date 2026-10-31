import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { i18n } from '../../../../i18n';
import { formatTimestamp } from '../../../../shared/date-time';

import { TelemetryItem } from './TelemetryItem';

it('shows the full observation time, raw numeric precision, unit and durability', () => {
    const item = { ...createHistoryIdentityFixtures().telemetrySample, value: 21.123456789 };
    render(<TelemetryItem item={item} />);
    expect(screen.getByRole('article')).toHaveTextContent('21.123456789 °C');
    expect(screen.getByText(formatTimestamp(item.occurredAt))).toHaveAttribute(
        'datetime',
        item.occurredAt,
    );
    expect(
        screen.getByText(i18n.t('telemetry.durability.durable', { ns: 'deviceDetails' })),
    ).toBeVisible();
});
