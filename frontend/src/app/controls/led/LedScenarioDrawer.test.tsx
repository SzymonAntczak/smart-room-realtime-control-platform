import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LedScenarioDrawer } from './LedScenarioDrawer';

type ScenarioClient = NonNullable<Parameters<typeof LedScenarioDrawer>[0]['client']>;

describe('LedScenarioDrawer', () => {
    it('groups available LED scenarios by command behavior, availability and health', async () => {
        const user = userEvent.setup();
        const client: ScenarioClient = {
            getScenarios: vi.fn().mockResolvedValue({
                deviceId: 'led-main',
                scenarios: [
                    { action: 'confirm_immediately' },
                    { action: 'disconnect_device' },
                    { action: 'degrade_device' },
                    { action: 'recover_device' },
                ],
            }),
            runScenario: vi.fn(),
            getDiagnostics: vi.fn(),
        };

        render(<LedScenarioDrawer deviceId="led-main" client={client} />);
        await user.click(screen.getByRole('button', { name: 'Dev scenarios' }));

        expect(
            await screen.findByRole('heading', { name: 'Command behavior', level: 3 }),
        ).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Availability', level: 3 })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Health', level: 3 })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mark device offline' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mark device degraded' })).toBeInTheDocument();
    });
});
