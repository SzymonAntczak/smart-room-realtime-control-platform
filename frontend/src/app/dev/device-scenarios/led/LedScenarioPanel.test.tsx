import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { DeviceScenarioClient } from '../device-scenario-client';

import { LedScenarioPanel } from './LedScenarioPanel';

describe('LedScenarioPanel', () => {
    it('configures the next LED command without rendering a changed confirmed state', async () => {
        const user = userEvent.setup();
        const client: DeviceScenarioClient = {
            runScenario: vi.fn().mockResolvedValue({
                action: 'confirm_delayed',
                status: 'completed',
            }),
            getDiagnostics: vi.fn(),
        };

        render(
            <LedScenarioPanel
                client={client}
                actions={['confirm_delayed']}
                isCommandActive={false}
                onRequestChange={vi.fn()}
            />,
        );
        await user.click(screen.getByRole('button', { name: 'Confirm after 2 seconds' }));

        expect(client.runScenario).toHaveBeenCalledWith('confirm_delayed');
        expect(screen.getByRole('status')).toHaveTextContent(
            'Confirm after 2 seconds selected for the next LED command.',
        );
    });

    it('does not allow scenario selection while an LED command is active', () => {
        render(
            <LedScenarioPanel
                client={{ runScenario: vi.fn(), getDiagnostics: vi.fn() }}
                actions={['confirm_immediately']}
                isCommandActive
                onRequestChange={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: 'Confirm immediately' })).toBeDisabled();
    });
});
