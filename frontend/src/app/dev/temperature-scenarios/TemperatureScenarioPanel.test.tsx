import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TemperatureScenarioResult } from '../../../../../shared/src/dev-scenarios';
import { TemperatureScenarioPanel } from './TemperatureScenarioPanel';
import type { TemperatureScenarioClient } from './temperature-scenario-client';

describe('TemperatureScenarioPanel', () => {
    it('sends a selected scenario to the local development control boundary', async () => {
        const runScenario = vi.fn().mockResolvedValue({
            action: 'pause_telemetry',
            status: 'completed',
        });
        const user = userEvent.setup();

        render(<TemperatureScenarioPanel client={{ runScenario }} />);
        await user.click(screen.getByRole('button', { name: 'Pause telemetry' }));

        expect(runScenario).toHaveBeenCalledWith('pause_telemetry');
        expect(await screen.findByRole('status')).toHaveTextContent('Pause telemetry completed.');
    });

    it('shows a failure without synthesizing room state', async () => {
        const user = userEvent.setup();
        const client: TemperatureScenarioClient = {
            runScenario: vi
                .fn()
                .mockRejectedValue(new Error('Scenario control request failed (404).')),
        };

        render(<TemperatureScenarioPanel client={client} />);
        await user.click(screen.getByRole('button', { name: 'Emit invalid reading' }));

        expect(await screen.findByRole('status')).toHaveTextContent(
            'Scenario control request failed (404).',
        );
    });

    it('disables every control while a scenario request is pending', async () => {
        let resolveScenario: ((value: TemperatureScenarioResult) => void) | undefined;
        const client: TemperatureScenarioClient = {
            runScenario: vi.fn(
                () =>
                    new Promise<TemperatureScenarioResult>((resolve) => {
                        resolveScenario = resolve;
                    }),
            ),
        };
        const user = userEvent.setup();

        render(<TemperatureScenarioPanel client={client} />);
        await user.click(screen.getByRole('button', { name: 'Pause telemetry' }));

        for (const button of screen.getAllByRole('button')) {
            expect(button).toBeDisabled();
        }

        resolveScenario?.({ action: 'pause_telemetry', status: 'completed' });

        expect(await screen.findByRole('status')).toHaveTextContent('Pause telemetry completed.');
    });
});
