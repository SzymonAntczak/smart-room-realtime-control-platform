import { describe, expect, it, vi } from 'vitest';

import { createDeviceScenarioClient } from './device-scenario-client';

describe('createDeviceScenarioClient', () => {
    it('uses one encoded device resource for discovery and scenario execution', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ deviceId: 'temp desk/1', scenarios: [] })),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ action: 'pause_telemetry', status: 'completed' })),
            );
        const client = createDeviceScenarioClient('temp desk/1', fetchMock);

        await client.getScenarios();
        await client.runScenario('pause_telemetry');

        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            'http://localhost:4310/dev/devices/temp%20desk%2F1/scenarios',
            'http://localhost:4310/dev/devices/temp%20desk%2F1/scenarios',
        ]);
    });

    it('rejects malformed successful scenario responses at the HTTP boundary', async () => {
        const client = createDeviceScenarioClient(
            'temp-desk',
            vi.fn().mockResolvedValue(new Response(JSON.stringify({ action: 'invalid' }))),
        );

        await expect(client.runScenario('pause_telemetry')).rejects.toThrow(
            'Scenario control returned an invalid response.',
        );
    });

    it('rejects a successful response for a different requested action', async () => {
        const client = createDeviceScenarioClient(
            'temp-desk',
            vi
                .fn()
                .mockResolvedValue(
                    new Response(JSON.stringify({ action: 'reset', status: 'completed' })),
                ),
        );

        await expect(client.runScenario('pause_telemetry')).rejects.toThrow(
            'Scenario control returned a response for a different action.',
        );
    });

    it('rejects malformed diagnostics at the HTTP boundary', async () => {
        const client = createDeviceScenarioClient(
            'temp-desk',
            vi
                .fn()
                .mockResolvedValue(
                    new Response(
                        JSON.stringify({ ignoredEvents: [{ observedAt: 'not-a-timestamp' }] }),
                    ),
                ),
        );

        await expect(client.getDiagnostics()).rejects.toThrow(
            'Diagnostics returned an invalid response.',
        );
    });
});
