import type { DeviceProjection } from '@smart-room/contracts/projections';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TemperatureControl } from './TemperatureControl';

const formatTimestamp = vi.hoisted(() => vi.fn(() => 'formatted local timestamp'));

vi.mock('../../../i18n/time', () => ({ formatTimestamp }));

describe('TemperatureControl', () => {
    it('formats the last reading timestamp for the browser before rendering it', () => {
        render(<TemperatureControl device={createTemperatureSensor()} />);

        expect(formatTimestamp).toHaveBeenCalledWith('2026-08-06T12:00:00Z');
        expect(screen.getByText(/formatted local timestamp/)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Temperatura biurka' })).toBeInTheDocument();
        expect(screen.getByText('°C')).toBeInTheDocument();
    });

    it('does not render a unit without a valid temperature reading', () => {
        render(
            <TemperatureControl
                device={{
                    ...createTemperatureSensor(),
                    reportedState: {},
                    observationStatus: { temperature: { freshness: 'unknown' } },
                }}
            />,
        );

        expect(screen.queryByText('°C')).not.toBeInTheDocument();
    });
});

function createTemperatureSensor(): DeviceProjection {
    return {
        deviceId: 'temp-desk',
        name: 'Desk temperature',
        role: 'temperature-sensor',
        availability: 'online',
        availabilityChangedAt: '2026-08-06T12:00:00Z',
        health: 'healthy',
        healthChangedAt: '2026-08-06T12:00:00Z',
        reportedState: { temperature: 22.4, temperatureUnit: 'celsius' },
        commandAvailability: { policy: 'block', reason: 'not-controllable' },
        observationStatus: {
            temperature: { freshness: 'fresh', lastObservedAt: '2026-08-06T12:00:00Z' },
        },
    };
}
