import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TelemetryTable } from './TelemetryTable';

describe('TelemetryTable', () => {
    it('renders raw sample values using semantic column headers', () => {
        const { telemetrySample } = createHistoryIdentityFixtures();
        render(<TelemetryTable samples={[telemetrySample]} />);

        const table = screen.getByRole('table', { name: 'Pomiary temperatury' });
        expect(
            within(table).getByRole('columnheader', { name: 'Czas obserwacji' }),
        ).toBeInTheDocument();
        expect(within(table).getByRole('columnheader', { name: 'Wartość' })).toBeInTheDocument();
        expect(within(table).getByRole('columnheader', { name: 'Jednostka' })).toBeInTheDocument();
        expect(within(table).getByRole('cell', { name: '22.5' })).toBeInTheDocument();
        expect(within(table).getByRole('cell', { name: '°C' })).toBeInTheDocument();
    });

    it('keeps the table available and explains that its history is empty', () => {
        render(<TelemetryTable samples={[]} />);

        expect(screen.getByRole('table', { name: 'Pomiary temperatury' })).toHaveTextContent(
            'Historia pomiarów nie jest jeszcze dostępna.',
        );
    });
});
