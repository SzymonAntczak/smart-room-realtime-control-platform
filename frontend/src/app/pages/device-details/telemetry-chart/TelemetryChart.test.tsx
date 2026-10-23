import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { i18n } from '../../../i18n';

import { TelemetryChart } from './TelemetryChart';

const firstSample = createHistoryIdentityFixtures().telemetrySample;

describe('TelemetryChart', () => {
    it('describes an empty plot without inventing measurements', () => {
        render(<TelemetryChart samples={[]} />);

        expect(
            screen.getByRole('application', {
                name: i18n.t('chart.title', { ns: 'deviceDetails' }),
            }),
        ).toHaveAccessibleDescription(i18n.t('chart.empty', { ns: 'deviceDetails' }));
        expect(screen.getByRole('application').querySelectorAll('circle')).toHaveLength(0);
    });

    it('plots a single measurement on a stable scale', () => {
        render(<TelemetryChart samples={[firstSample]} />);

        expect(screen.getByRole('application')).toHaveAccessibleDescription(/22\.5/);
        expect(screen.getByRole('application').querySelectorAll('circle')).toHaveLength(1);
    });

    it('identifies volatile measurements in the accessible chart description', () => {
        render(
            <TelemetryChart
                samples={[
                    {
                        recordId: firstSample.recordId,
                        deviceId: firstSample.deviceId,
                        metric: firstSample.metric,
                        value: firstSample.value,
                        unit: firstSample.unit,
                        occurredAt: firstSample.occurredAt,
                        durability: 'volatile',
                    },
                ]}
            />,
        );

        expect(screen.getByRole('application')).toHaveAccessibleDescription(
            expect.stringContaining(
                i18n.t('telemetry.durability.volatile', { ns: 'deviceDetails' }),
            ),
        );
    });

    it('handles flat values and equal timestamps without producing invalid coordinates', () => {
        const secondSample = {
            ...firstSample,
            recordId: `rec:v1:sha256:${'c'.repeat(64)}`,
            storageSequence: firstSample.storageSequence + 1,
        };
        render(<TelemetryChart samples={[firstSample, secondSample]} />);

        const points = screen.getByRole('application').querySelectorAll('circle');
        expect(points).toHaveLength(2);

        for (const point of points) {
            expect(Number.isFinite(Number(point.getAttribute('cx')))).toBe(true);
            expect(Number.isFinite(Number(point.getAttribute('cy')))).toBe(true);
        }

        expect(points[0].getAttribute('cx')).toBe(points[1].getAttribute('cx'));
        expect(points[0].getAttribute('cy')).toBe(points[1].getAttribute('cy'));
        expect(screen.getByRole('application')).toHaveTextContent('22');
        expect(screen.getByRole('application')).toHaveTextContent('23');
    });

    it('preserves irregular observation intervals and every value at a shared timestamp', () => {
        const samples = [0, 1000, 10000, 10000].map((offset, index) => ({
            ...firstSample,
            recordId: `rec:v1:sha256:${String(index).padStart(64, '0')}`,
            value: 20 + index,
            occurredAt: new Date(Date.parse(firstSample.occurredAt) + offset).toISOString(),
        }));
        render(<TelemetryChart samples={samples} />);
        const points = [...screen.getByRole('application').querySelectorAll('circle')];
        expect(points).toHaveLength(4);
        const positions = points.map((point) => Number(point.getAttribute('cx')));
        expect((positions[1] - positions[0]) / (positions[2] - positions[0])).toBeCloseTo(0.1);
        expect(positions[2]).toBe(positions[3]);
        expect(points[2].getAttribute('cy')).not.toBe(points[3].getAttribute('cy'));
    });
});
