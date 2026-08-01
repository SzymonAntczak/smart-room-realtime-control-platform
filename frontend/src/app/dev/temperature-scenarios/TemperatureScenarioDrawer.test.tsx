import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TemperatureScenarioDrawer } from './TemperatureScenarioDrawer';

describe('TemperatureScenarioDrawer', () => {
    it('keeps scenario controls out of the document until the drawer is opened', async () => {
        const user = userEvent.setup();
        render(<TemperatureScenarioDrawer />);

        const toggle = screen.getByRole('button', { name: 'Dev scenarios' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
        expect(
            screen.queryByRole('heading', { name: 'Temperature scenarios' }),
        ).not.toBeInTheDocument();

        await user.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('heading', { name: 'Temperature scenarios' })).toBeInTheDocument();
        const closeButton = screen.getByRole('button', { name: 'Close panel' });
        expect(closeButton.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
        expect(closeButton).toHaveFocus();
    });

    it('closes the drawer with its visible close control', async () => {
        const user = userEvent.setup();
        render(<TemperatureScenarioDrawer />);

        await user.click(screen.getByRole('button', { name: 'Dev scenarios' }));
        await user.click(screen.getByRole('button', { name: 'Close panel' }));

        expect(
            screen.queryByRole('heading', { name: 'Temperature scenarios' }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Dev scenarios' })).toHaveFocus();
    });

    it('closes the non-modal drawer with Escape and restores focus to its toggle', async () => {
        const user = userEvent.setup();
        render(<TemperatureScenarioDrawer />);

        await user.click(screen.getByRole('button', { name: 'Dev scenarios' }));
        await user.keyboard('{Escape}');

        expect(
            screen.queryByRole('heading', { name: 'Temperature scenarios' }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Dev scenarios' })).toHaveFocus();
    });
});
