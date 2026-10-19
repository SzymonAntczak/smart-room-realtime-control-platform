import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TelemetryPanel } from './TelemetryPanel';

describe('TelemetryPanel', () => {
    it('presents the same raw measurements in its chart description and table', () => {
        const first = createHistoryIdentityFixtures().telemetrySample;
        const second = {
            ...first,
            recordId: `rec:v1:sha256:${'c'.repeat(64)}`,
            storageSequence: first.storageSequence + 1,
            value: 24.1,
            occurredAt: '2026-09-10T10:10:00.000Z',
        };
        render(<TelemetryPanel samples={[first, second]} />);

        const chart = screen.getByRole('img', { name: 'Wykres temperatury w czasie' });
        const table = screen.getByRole('table', { name: 'Pomiary temperatury' });

        expect(chart).toHaveAccessibleDescription(/Temperatura w czasie \(°C\): .*22\.5; .*24\.1/);
        expect(within(table).getByRole('cell', { name: '22.5' })).toBeInTheDocument();
        expect(within(table).getByRole('cell', { name: '24.1' })).toBeInTheDocument();
    });
});
