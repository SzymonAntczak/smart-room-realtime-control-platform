import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ScenarioActionDefinition } from '../scenario-definition';

import { DevPanelAction } from './DevPanelAction';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('DevPanelAction', () => {
    it('reports its active state and prevents a disabled scenario action', () => {
        const action: ScenarioActionDefinition = {
            action: 'confirm_delayed',
            icon: 'timer',
            labelKey: 'scenario.confirmDelayed',
            outcome: 'completed',
        };
        const onClick = vi.fn();
        render(<DevPanelAction action={action} disabled isActive onClick={onClick} />);

        expect(screen.getByRole('button', { name: action.labelKey })).toHaveAttribute(
            'aria-busy',
            'true',
        );
        expect(screen.getByRole('button')).toBeDisabled();
    });
});
