import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ledScenarioDefinition } from '../../scenarios';

import { DevPanelContent } from './DevPanelContent';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('DevPanelContent', () => {
    it('renders only available actions and blocks actions during an active command', () => {
        render(
            <DevPanelContent
                availableActions={['confirm_delayed']}
                definition={ledScenarioDefinition}
                isCommandActive
                isOffline={false}
                onRunScenario={() => undefined}
            />,
        );

        expect(
            screen.getByRole('button', { name: 'scenarios.led.actions.confirmDelayed' }),
        ).toBeDisabled();
        expect(
            screen.queryByRole('button', { name: 'scenarios.led.actions.confirmImmediately' }),
        ).toBeNull();
    });
});
