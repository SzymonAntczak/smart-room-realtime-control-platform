import {
    acceptedCommandResponseSchema,
    preAdmissionCommandErrorResponseSchema,
    rejectedCommandResponseSchema,
    type SetPowerCommandRequest,
} from '@smart-room/contracts/commands';
import { isSchema } from '@smart-room/contracts/validation';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { submitLedPowerCommand } from './led-command-client';

const request: SetPowerCommandRequest = {
    deviceId: 'led-main',
    commandType: 'set.power',
    requestedState: { power: 'on' },
};
const accepted = {
    commandId: 'command-one',
    status: 'accepted',
    durability: 'durable',
    lifecycleDurability: 'durable',
};
const rejected = {
    ...accepted,
    status: 'rejected',
    reason: 'command_in_progress',
    message: 'Another command is active.',
};

describe('LED command HTTP client', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('posts validated intent to the default command endpoint without changing reported state', async () => {
        expect(isSchema(acceptedCommandResponseSchema, accepted)).toBe(true);
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(JSON.stringify(accepted), { status: 202 }));

        expect(await submitLedPowerCommand(request, fetcher)).toEqual(accepted);
        expect(fetcher).toHaveBeenCalledExactlyOnceWith('http://localhost:4310/room/commands', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
        });
    });

    it('uses the independently configured command URL and preserves volatile admission evidence', async () => {
        vi.stubEnv('VITE_ROOM_COMMAND_URL', 'http://127.0.0.1:4999/custom-commands');
        const volatile = { ...accepted, durability: 'volatile', lifecycleDurability: 'volatile' };
        expect(isSchema(acceptedCommandResponseSchema, volatile)).toBe(true);
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(JSON.stringify(volatile), { status: 202 }));

        expect(await submitLedPowerCommand(request, fetcher)).toEqual(volatile);
        expect(fetcher.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4999/custom-commands');
    });

    it.each([409, 422])('preserves an admitted rejection for HTTP %s', async (status) => {
        expect(isSchema(rejectedCommandResponseSchema, rejected)).toBe(true);
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(JSON.stringify(rejected), { status }));

        expect(await submitLedPowerCommand(request, fetcher)).toEqual(rejected);
    });

    it.each([
        [404, { error: 'unknown_device', message: 'Unknown device.' }],
        [503, { error: 'platform_recovering', message: 'Retry after recovery.', retryable: true }],
    ])(
        'preserves pre-admission HTTP %s errors without inventing a command',
        async (status, body) => {
            expect(isSchema(preAdmissionCommandErrorResponseSchema, body)).toBe(true);
            const fetcher = vi
                .fn<typeof fetch>()
                .mockResolvedValue(new Response(JSON.stringify(body), { status }));

            expect(await submitLedPowerCommand(request, fetcher)).toEqual(body);
        },
    );

    it('rejects malformed intent before making an HTTP request', async () => {
        const fetcher = vi.fn<typeof fetch>();

        await expect(submitLedPowerCommand({ ...request, deviceId: '' }, fetcher)).rejects.toThrow(
            'command contract',
        );
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each([
        [200, accepted],
        [202, rejected],
        [409, accepted],
        [202, { ...accepted, lifecycleDurability: 'unknown' }],
        [202, { ...accepted, reportedPower: 'on' }],
        [503, { error: 'platform_recovering', message: 'Recovering.' }],
        [500, { error: 'unknown_device', message: 'Unknown device.' }],
    ])(
        'rejects HTTP %s responses with mismatched status or contract (%j)',
        async (status, body) => {
            const fetcher = vi
                .fn<typeof fetch>()
                .mockResolvedValue(new Response(JSON.stringify(body), { status }));

            await expect(submitLedPowerCommand(request, fetcher)).rejects.toThrow(
                'invalid response',
            );
        },
    );

    it('rejects non-JSON responses and propagates network errors', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response('not JSON', { status: 202 }))
            .mockRejectedValueOnce(new TypeError('Network unavailable'));

        await expect(submitLedPowerCommand(request, fetcher)).rejects.toThrow('invalid response');
        await expect(submitLedPowerCommand(request, fetcher)).rejects.toThrow(
            'Network unavailable',
        );
    });
});
