import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DevPanelButton } from './DevPanelButton';

describe('DevPanelButton', () => {
    it('keeps native button attributes and children', () => {
        render(
            <DevPanelButton type="button" aria-expanded="false" variant="trigger">
                Scenarios
            </DevPanelButton>,
        );

        expect(screen.getByRole('button', { name: 'Scenarios' })).toHaveAttribute(
            'aria-expanded',
            'false',
        );
    });
});
