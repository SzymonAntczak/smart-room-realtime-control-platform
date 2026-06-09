import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemperatureControl } from './TemperatureControl';

describe('TemperatureControl', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-08T09:30:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders the simulated temperature sensor reading', () => {
        render(<TemperatureControl />);

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(screen.getByText('Simulated realtime')).toBeInTheDocument();
        expect(screen.getByText('Live')).toBeInTheDocument();
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.1');
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('celsius');
        expect(screen.getByText('09:30:00 UTC')).toBeInTheDocument();
    });

    it('updates the reading on the realtime interval', () => {
        render(<TemperatureControl />);

        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.3');
        expect(screen.getByText('09:30:01 UTC')).toBeInTheDocument();
    });
});
