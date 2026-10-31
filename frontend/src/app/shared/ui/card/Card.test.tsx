import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { Card } from './Card';

it('exposes a named section with its composed content', () => {
    render(
        <Card aria-labelledby="measurements-heading">
            <h2 id="measurements-heading">Measurements</h2>
            <p>22.4 °C</p>
        </Card>,
    );

    const card = screen.getByRole('region', { name: 'Measurements' });
    expect(within(card).getByRole('heading', { level: 2 })).toBeVisible();
    expect(within(card).getByText('22.4 °C')).toBeVisible();
});
