import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createBackendIntegrationRuntime } from './backend-integration-runtime';

describe('backend integration runtime harness', () => {
    it('uses native factory doubles with a real backend and closes every acquired resource', async () => {
        const backend = await createBackendIntegrationRuntime();
        const stream = await backend.connectSse();
        expect(stream.messages[0]?.messageType).toBe('room.snapshot');
        expect((await backend.snapshot()).platform.storage.status).toBe('available');
        expect(existsSync(backend.directory)).toBe(true);
        await backend.close();
        await backend.close();
        expect(backend.server.server.listening).toBe(false);
        expect(existsSync(backend.directory)).toBe(false);
        await expect(fetch(`${backend.baseUrl}/room`)).rejects.toThrow();
    });

    it('isolates native inputs between two live backend instances', async () => {
        const original = await createBackendIntegrationRuntime();
        const next = await createBackendIntegrationRuntime();
        original.clock.advanceBy(1);
        next.clock.advanceBy(1);
        original.sources.desk.read(30, original.clock.now());
        expect(
            (await original.snapshot()).devices.find((device) => device.deviceId === 'temp-desk')
                ?.reportedState.temperature,
        ).toBe(30);
        expect(
            (await next.snapshot()).devices.find((device) => device.deviceId === 'temp-desk')
                ?.reportedState.temperature,
        ).toBe(22);
        expect(original.historyGenerationId).not.toBe(next.historyGenerationId);
    });
});
