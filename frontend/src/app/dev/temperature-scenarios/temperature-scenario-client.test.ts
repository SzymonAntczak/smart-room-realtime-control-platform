import { describe, expect, it, vi } from 'vitest';
import { createTemperatureScenarioClient } from './temperature-scenario-client';

describe('createTemperatureScenarioClient', () => {
    it('posts a scenario action and returns the validated result', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ action: 'pause_telemetry', status: 'completed' }), {
                status: 200,
            }),
        );
        const client = createTemperatureScenarioClient(fetchMock, 'http://localhost:4310/dev/test');

        await expect(client.runScenario('pause_telemetry')).resolves.toEqual({
            action: 'pause_telemetry',
            status: 'completed',
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:4310/dev/test',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ action: 'pause_telemetry' }),
            }),
        );
    });

    it('rejects a malformed successful response at the HTTP boundary', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ action: 'not_a_scenario', status: 'completed' }), {
                status: 200,
            }),
        );
        const client = createTemperatureScenarioClient(fetchMock);

        await expect(client.runScenario('pause_telemetry')).rejects.toThrow(
            'Scenario control returned an invalid response.',
        );
    });

    it('rejects a valid response that belongs to a different requested action', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ action: 'reset', status: 'completed' }), {
                status: 200,
            }),
        );
        const client = createTemperatureScenarioClient(fetchMock);

        await expect(client.runScenario('pause_telemetry')).rejects.toThrow(
            'Scenario control returned a response for a different action.',
        );
    });
});
