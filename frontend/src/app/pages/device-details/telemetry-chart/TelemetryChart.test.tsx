import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TelemetryChart } from './TelemetryChart';

const firstSample = createHistoryIdentityFixtures().telemetrySample;

describe('TelemetryChart', () => {
    it('describes an empty plot without inventing measurements', () => {
        render(<TelemetryChart samples={[]} />);

        expect(
            screen.getByRole('img', { name: 'Wykres temperatury w czasie' }),
        ).toHaveAccessibleDescription('Brak punktów pomiarowych do wyświetlenia.');
    });

    it('plots a single measurement on a stable scale', () => {
        render(<TelemetryChart samples={[firstSample]} />);

        expect(screen.getByRole('img')).toHaveAccessibleDescription(/22\.5/);
    });

    it('handles flat values and equal timestamps without producing invalid coordinates', () => {
        const secondSample = {
            ...firstSample,
            recordId: `rec:v1:sha256:${'c'.repeat(64)}`,
            storageSequence: firstSample.storageSequence + 1,
        };
        const { container } = render(<TelemetryChart samples={[firstSample, secondSample]} />);

        expect(container.querySelector('polyline')?.getAttribute('points')).toMatch(
            /^\d+(\.\d+)?,\d+(\.\d+)? \d+(\.\d+)?,\d+(\.\d+)?$/,
        );
    });
});
