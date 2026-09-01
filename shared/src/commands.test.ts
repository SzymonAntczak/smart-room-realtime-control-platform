import { describe, expect, it } from 'vitest';

import {
    acceptedCommandResponseSchema,
    preAdmissionCommandErrorResponseSchema,
    rejectedCommandResponseSchema,
    setPowerCommandRequestSchema,
} from './commands';
import { isSchema } from './validation';

describe('set.power HTTP contracts', () => {
    const request = {
        deviceId: 'led-main',
        commandType: 'set.power',
        requestedState: { power: 'on' },
    } as const;

    it('accepts a valid request and rejects malformed or undocumented input', () => {
        expect(isSchema(setPowerCommandRequestSchema, request)).toBe(true);
        expect(
            isSchema(setPowerCommandRequestSchema, {
                ...request,
                requestedState: { power: 'dim' },
            }),
        ).toBe(false);
        expect(
            isSchema(setPowerCommandRequestSchema, {
                ...request,
                requestedState: { power: 'on', brightness: 50 },
            }),
        ).toBe(false);
        expect(isSchema(setPowerCommandRequestSchema, { ...request, deviceId: '' })).toBe(false);
        expect(
            isSchema(setPowerCommandRequestSchema, { ...request, commandType: 'set.level' }),
        ).toBe(false);
        expect(isSchema(setPowerCommandRequestSchema, { ...request, confirmed: true })).toBe(false);
    });

    it('distinguishes backend acceptance from rejection without a confirmation field', () => {
        expect(
            isSchema(acceptedCommandResponseSchema, {
                commandId: 'cmd-1',
                status: 'accepted',
                durability: 'durable',
                lifecycleDurability: 'durable',
            }),
        ).toBe(true);
        expect(
            isSchema(acceptedCommandResponseSchema, {
                commandId: 'cmd-1',
                status: 'confirmed',
            }),
        ).toBe(false);
        expect(
            isSchema(rejectedCommandResponseSchema, {
                commandId: 'cmd-2',
                status: 'rejected',
                reason: 'command_already_active',
                message: 'The device already has an active command.',
                durability: 'volatile',
                lifecycleDurability: 'volatile',
            }),
        ).toBe(true);
        expect(
            isSchema(rejectedCommandResponseSchema, {
                status: 'rejected',
                reason: 'command_already_active',
                message: 'The device already has an active command.',
            }),
        ).toBe(false);
        expect(
            isSchema(preAdmissionCommandErrorResponseSchema, {
                error: 'platform_recovering',
                message: 'The platform is recovering.',
                retryable: true,
            }),
        ).toBe(true);
        expect(
            isSchema(preAdmissionCommandErrorResponseSchema, {
                error: 'unknown_device',
                message: 'Unknown device.',
                commandId: 'cmd-should-not-exist',
            }),
        ).toBe(false);
        expect(
            isSchema(preAdmissionCommandErrorResponseSchema, {
                error: 'unknown_device',
                message: 'Unknown device.',
                retryable: true,
            }),
        ).toBe(false);
        expect(
            isSchema(preAdmissionCommandErrorResponseSchema, {
                error: 'platform_recovering',
                message: 'The platform is recovering.',
            }),
        ).toBe(false);
    });
});
