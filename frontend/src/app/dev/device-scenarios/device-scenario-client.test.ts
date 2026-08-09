import { describe, expect, it, vi } from 'vitest';

import { createDeviceScenarioClient, createScenarioClient } from './device-scenario-client';

describe('createScenarioClient', () => {
    it('posts a scenario action and returns the validated result', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ action: 'pause_telemetry', status: 'completed' }), {
                status: 200,
            }),
        );
        const client = createScenarioClient(fetchMock, 'http://localhost:4310/dev/test');

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
        const client = createScenarioClient(fetchMock);

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
        const client = createScenarioClient(fetchMock);

        await expect(client.runScenario('pause_telemetry')).rejects.toThrow(
            'Scenario control returned a response for a different action.',
        );
    });

    it('retrieves a validated diagnostics snapshot', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    ignoredEvents: [
                        {
                            diagnosticId: 'diag-1',
                            reason: 'invalid_payload',
                            observedAt: '2026-06-08T09:30:01Z',
                        },
                    ],
                }),
                { status: 200 },
            ),
        );
        const client = createScenarioClient(
            fetchMock,
            'http://localhost:4310/dev/test',
            'http://localhost:4310/diagnostics-test',
        );

        await expect(client.getDiagnostics()).resolves.toMatchObject({
            ignoredEvents: [
                {
                    diagnosticId: 'diag-1',
                    reason: 'invalid_payload',
                },
            ],
        });
        expect(fetchMock).toHaveBeenCalledWith('http://localhost:4310/diagnostics-test');
    });

    it('rejects diagnostics with an invalid timestamp at the HTTP boundary', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    ignoredEvents: [
                        {
                            diagnosticId: 'diag-1',
                            reason: 'invalid_payload',
                            observedAt: 'not-a-timestamp',
                        },
                    ],
                }),
                { status: 200 },
            ),
        );
        const client = createScenarioClient(fetchMock);

        await expect(client.getDiagnostics()).rejects.toThrow(
            'Diagnostics returned an invalid response.',
        );
    });

    it('uses the same encoded device resource for discovery and scenario execution', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ deviceId: 'temp desk/1', scenarios: [] }), {
                    status: 200,
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ action: 'pause_telemetry', status: 'completed' }), {
                    status: 200,
                }),
            );
        const client = createDeviceScenarioClient('temp desk/1', fetchMock);

        await client.getScenarios!();
        await client.runScenario('pause_telemetry');

        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            'http://localhost:4310/dev/devices/temp%20desk%2F1/scenarios',
            'http://localhost:4310/dev/devices/temp%20desk%2F1/scenarios',
        ]);
    });

    it('rejects discovery for a different device', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ deviceId: 'other-device', scenarios: [] }), {
                status: 200,
            }),
        );
        const client = createDeviceScenarioClient('temp-desk', fetchMock);

        await expect(client.getScenarios!()).rejects.toThrow('different device');
    });
});
