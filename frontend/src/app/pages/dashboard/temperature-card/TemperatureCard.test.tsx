import { deviceProjectionSchema } from '@smart-room/contracts/projections';
import { isSchema } from '@smart-room/contracts/validation';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TemperatureCard, type TemperatureSensorDeviceProjection } from './TemperatureCard';

const formatTimestamp = vi.hoisted(() => vi.fn(() => 'formatted local timestamp'));

vi.mock('../../../features/date-time', () => ({ formatTimestamp }));

describe('TemperatureCard', () => {
    it('keeps volatile temperature and health independent of durable availability through stale and reconnect', () => {
        const device: TemperatureSensorDeviceProjection = {
            ...createTemperatureSensor(),
            healthDurability: 'volatile',
            observationStatus: {
                temperature: {
                    freshness: 'stale',
                    lastObservedAt: '2026-08-06T12:00:00Z',
                    durability: 'volatile',
                },
            },
        };
        expect(isSchema(deviceProjectionSchema, device)).toBe(true);
        const { rerender } = render(<TemperatureCard device={device} />);
        expect(screen.getByText('Dane temperatury — dane nieutrwalone')).toBeInTheDocument();
        expect(screen.getByText('Stan działania — dane nieutrwalone')).toBeInTheDocument();
        expect(screen.queryByText('Dostępność — dane nieutrwalone')).toBeNull();
        expect(screen.getByText(/formatted local timestamp/)).toBeInTheDocument();
        rerender(<TemperatureCard device={device} realtimeUncertain />);
        expect(screen.getByText('Dane temperatury — dane nieutrwalone')).toBeInTheDocument();
        expect(screen.getByText(/ponownie/)).toBeInTheDocument();
    });

    it('labels unknown volatile evidence without fabricating a reading', () => {
        const device: TemperatureSensorDeviceProjection = {
            ...createTemperatureSensor(),
            availability: 'unknown',
            availabilityDurability: 'volatile',
            health: 'unknown',
            healthDurability: 'volatile',
            reportedState: {},
            observationStatus: { temperature: { freshness: 'unknown', durability: 'volatile' } },
        };
        expect(isSchema(deviceProjectionSchema, device)).toBe(true);
        render(<TemperatureCard device={device} />);
        expect(screen.getAllByText(/— dane nieutrwalone/)).toHaveLength(3);
        expect(screen.queryByText('°C')).toBeNull();
    });

    it('formats the last reading timestamp for the browser before rendering it', () => {
        render(<TemperatureCard device={createTemperatureSensor()} />);

        expect(formatTimestamp).toHaveBeenCalledWith('2026-08-06T12:00:00Z');
        expect(screen.getByText(/formatted local timestamp/)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Temperatura biurka' })).toBeInTheDocument();
        expect(screen.getByText('°C')).toBeInTheDocument();
        expect(screen.queryByText(/dane nieutrwalone/)).toBeNull();
    });

    it('does not render a unit without a valid temperature reading', () => {
        render(
            <TemperatureCard
                device={{
                    ...createTemperatureSensor(),
                    reportedState: {},
                    observationStatus: {
                        temperature: { freshness: 'unknown', durability: 'durable' },
                    },
                }}
            />,
        );

        expect(screen.queryByText('°C')).not.toBeInTheDocument();
    });
});

function createTemperatureSensor(): TemperatureSensorDeviceProjection {
    return {
        deviceId: 'temp-desk',
        name: 'Desk temperature',
        role: 'temperature-sensor',
        availability: 'online',
        availabilityChangedAt: '2026-08-06T12:00:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-08-06T12:00:00Z',
        healthDurability: 'durable',
        reportedState: { temperature: 22.4, temperatureUnit: 'celsius' },
        commandAvailability: { policy: 'block', reason: 'not-controllable' },
        observationStatus: {
            temperature: {
                freshness: 'fresh',
                lastObservedAt: '2026-08-06T12:00:00Z',
                durability: 'durable',
            },
        },
    };
}
