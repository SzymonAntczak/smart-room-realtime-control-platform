import { describe, expect, it, vi } from 'vitest';

import { MockCommandResponses } from './mock-command-responses';

describe('mock command response control', () => {
    it('holds a recovering response without allocating a command ID and releases it on demand', async () => {
        const responses = new MockCommandResponses();
        const generateCommandId = vi.fn(() => 'mock-command-1');
        responses.configure('recovering', true);

        const pending = responses.take(generateCommandId);

        expect(responses.hasHeldResponse()).toBe(true);
        expect(generateCommandId).not.toHaveBeenCalled();
        responses.release();

        await expect(pending).resolves.toEqual({
            status: 503,
            body: {
                error: 'platform_recovering',
                message: 'Retry after storage recovery.',
                retryable: true,
            },
        });
        expect(responses.hasHeldResponse()).toBe(false);
    });

    it('releases an outstanding response during reset and clears scripted outcomes', async () => {
        const responses = new MockCommandResponses();
        responses.configure('recovering', true);
        const pending = responses.take(() => 'mock-command-1');

        responses.reset();

        await expect(pending).resolves.toMatchObject({ status: 503 });
        expect(responses.hasHeldResponse()).toBe(false);
        await expect(responses.take(() => 'mock-command-2')).resolves.toMatchObject({
            status: 202,
            body: { commandId: 'mock-command-2', durability: 'durable' },
        });
    });
});
