import { render, screen } from '@testing-library/react';
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
                bottomAlert={<p>Reading is current</p>}
            >
                <p>21.5 °C</p>
            </DeviceCard>,
        );

        expect(screen.getByRole('heading', { name: 'Temperature sensor' })).toBeInTheDocument();
        expect(screen.getByTestId('temperature-card-status')).toHaveTextContent('Online');
        expect(screen.getByText('21.5 °C')).toBeInTheDocument();
        expect(screen.getByText('Reading is current')).toBeInTheDocument();
    });
});
