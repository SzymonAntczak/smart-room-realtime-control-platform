import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeviceCard } from './DeviceCard';

describe('DeviceCard', () => {
    it('renders its title, status, content and bottom alert', () => {
        render(
            <DeviceCard
                title="Temperature sensor"
                titleId="temperature-title"
                testId="temperature-card"
                status="Online"
                headerAction={<button type="button">Details</button>}
                bottomAlert={<p>Reading is current</p>}
            >
                <p>21.5 °C</p>
            </DeviceCard>,
        );

        const card = screen.getByRole('region', { name: 'Temperature sensor' });
        expect(card).toBe(screen.getByTestId('temperature-card'));
        expect(
            within(card).getByRole('heading', { name: 'Temperature sensor' }),
        ).toBeInTheDocument();
        expect(within(card).getByRole('button', { name: 'Details' })).toBeInTheDocument();
        expect(within(card).getByRole('status')).toHaveAttribute('aria-live', 'polite');
        expect(screen.getByTestId('temperature-card-status')).toHaveTextContent('Online');
        expect(screen.getByText('21.5 °C')).toBeInTheDocument();
        expect(screen.getByText('Reading is current')).toBeInTheDocument();
    });
});
