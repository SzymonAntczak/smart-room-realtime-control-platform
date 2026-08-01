import type {
    EventProcessingDiagnosticsSnapshot,
    TemperatureScenarioResult,
} from '@smart-room/contracts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TemperatureScenarioClient } from './temperature-scenario-client';
import { TemperatureScenarioPanel } from './TemperatureScenarioPanel';

describe('TemperatureScenarioPanel', () => {
    function createDeferred<Value>() {
        let resolve: ((value: Value) => void) | undefined;

        return {
            promise: new Promise<Value>((nextResolve) => {
                resolve = nextResolve;
            }),
            resolve(value: Value) {
                resolve?.(value);
            },
        };
    }

    it('sends a selected scenario to the local development control boundary', async () => {
        const runScenario = vi.fn().mockResolvedValue({
            action: 'pause_telemetry',
            status: 'completed',
        });
        const user = userEvent.setup();

        render(
            <TemperatureScenarioPanel
                client={{
                    runScenario,
                    getDiagnostics: vi.fn().mockResolvedValue({ ignoredEvents: [] }),
                }}
            />,
        );
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
            getDiagnostics: vi.fn(),
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
            getDiagnostics: vi.fn(),
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

    it('loads ignored event diagnostics on demand', async () => {
        const user = userEvent.setup();
        const client: TemperatureScenarioClient = {
            runScenario: vi.fn(),
            getDiagnostics: vi.fn().mockResolvedValue({
                ignoredEvents: [
                    {
                        diagnosticId: 'diag-1',
                        reason: 'duplicate_event',
                        observedAt: '2026-06-08T09:30:01Z',
                        eventType: 'telemetry.reading.recorded',
                        deviceId: 'temp-desk',
                    },
                ],
            }),
        };

        render(<TemperatureScenarioPanel client={client} />);
        await user.click(screen.getByRole('button', { name: 'Refresh diagnostics' }));

        expect(await screen.findByText('duplicate_event')).toBeInTheDocument();
        expect(screen.getByText('temp-desk')).toBeInTheDocument();
        expect(screen.getByText('Ignored events: 1')).toBeInTheDocument();
    });

    it('completes a scenario while its follow-up diagnostics request is still pending', async () => {
        const pendingDiagnostics = createDeferred<EventProcessingDiagnosticsSnapshot>();
        const client: TemperatureScenarioClient = {
            runScenario: vi.fn().mockResolvedValue({
                action: 'pause_telemetry',
                status: 'completed',
            }),
            getDiagnostics: vi.fn().mockReturnValue(pendingDiagnostics.promise),
        };
        const user = userEvent.setup();

        render(<TemperatureScenarioPanel client={client} />);
        await user.click(screen.getByRole('button', { name: 'Pause telemetry' }));

        expect(await screen.findByRole('status')).toHaveTextContent('Pause telemetry completed.');
        expect(screen.getByRole('button', { name: 'Pause telemetry' })).toBeEnabled();
    });

    it('keeps the newest diagnostics snapshot when refreshes resolve out of order', async () => {
        const firstDiagnostics = createDeferred<EventProcessingDiagnosticsSnapshot>();
        const secondDiagnostics = createDeferred<EventProcessingDiagnosticsSnapshot>();
        const client: TemperatureScenarioClient = {
            runScenario: vi.fn().mockResolvedValue({
                action: 'replay_last_reading',
                status: 'completed',
            }),
            getDiagnostics: vi
                .fn()
                .mockReturnValueOnce(firstDiagnostics.promise)
                .mockReturnValueOnce(secondDiagnostics.promise),
        };
        const user = userEvent.setup();

        render(<TemperatureScenarioPanel client={client} />);
        await user.click(screen.getByRole('button', { name: 'Refresh diagnostics' }));
        await user.click(screen.getByRole('button', { name: 'Replay last reading' }));

        secondDiagnostics.resolve({
            ignoredEvents: [
                {
                    diagnosticId: 'diag-new',
                    reason: 'duplicate_event',
                    observedAt: '2026-06-08T09:30:01Z',
                },
            ],
        });

        expect(await screen.findByText('duplicate_event')).toBeInTheDocument();

        firstDiagnostics.resolve({ ignoredEvents: [] });

        await waitFor(() => {
            expect(screen.getByText('duplicate_event')).toBeInTheDocument();
            expect(screen.getByText('Ignored events: 1')).toBeInTheDocument();
        });
    });
});
