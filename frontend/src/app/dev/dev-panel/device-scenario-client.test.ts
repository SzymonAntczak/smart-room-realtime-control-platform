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
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        historyGenerationId: 'generation-1',
                        entries: [
                            {
                                internalSequence: 1,
                                reason: 'duplicate_event',
                                recordedAt: 'not-a-timestamp',
                            },
                        ],
                    }),
                ),
            ),
        );

        await expect(client.getDiagnostics()).rejects.toThrow(
            'Diagnostics returned an invalid response.',
        );
    });

    it('validates persisted diagnostics and rejects non-successful storage responses', async () => {
        const snapshot = {
            historyGenerationId: 'generation-1',
            entries: [
                {
                    internalSequence: 1,
                    reason: 'duplicate_event',
                    recordedAt: '2026-09-10T10:00:00.000Z',
                },
            ],
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(snapshot)))
            .mockResolvedValueOnce(new Response('{}', { status: 503 }));
        const client = createDeviceScenarioClient('temp-desk', fetchMock);
        await expect(client.getDiagnostics()).resolves.toEqual(snapshot);
        await expect(client.getDiagnostics()).rejects.toThrow('Diagnostics request failed (503).');
        expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:4310/diagnostics');
    });

    it('rejects structurally valid diagnostics in the wrong order', async () => {
        const client = createDeviceScenarioClient(
            'temp-desk',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        historyGenerationId: 'generation-1',
                        entries: [1, 2].map((internalSequence) => ({
                            internalSequence,
                            reason: 'duplicate_event',
                            recordedAt: '2026-09-10T10:00:00.000Z',
                        })),
                    }),
                ),
            ),
        );
        await expect(client.getDiagnostics()).rejects.toThrow(
            'Diagnostics returned an invalid response.',
        );
    });
});
