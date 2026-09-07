import { describe, expect, it } from 'vitest';

import {
    acceptedCommandResponseSchema,
    isRecentCommandsOrdered,
    preAdmissionCommandErrorResponseSchema,
    rejectedCommandResponseSchema,
    selectRecentCommands,
    setPowerCommandRequestSchema,
    type TerminalCommandProjection,
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

describe('recent command cache ordering', () => {
    it('orders discriminated terminal timestamps by command ID and retains the greatest 20', () => {
        const terminalAt = '2026-08-14T10:00:02.000Z';
        const commands = [
            {
                commandId: 'cmd-a',
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
                requestedAt: '2026-08-14T10:00:00.000Z',
                durability: 'durable',
                lifecycleDurability: 'durable',
                status: 'confirmed',
                delivery: {
                    status: 'handed_off',
                    dispatchedAt: '2026-08-14T10:00:01.000Z',
                    deadlineAt: '2026-08-14T10:00:06.000Z',
                },
                confirmedAt: terminalAt,
            },
            {
                commandId: 'cmd-m',
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
                requestedAt: '2026-08-14T10:00:00.000Z',
                durability: 'durable',
                lifecycleDurability: 'durable',
                status: 'failed',
                failedAt: terminalAt,
                reason: 'device_rejected',
                message: 'The device rejected the command.',
            },
            {
                commandId: 'cmd-z',
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
                requestedAt: '2026-08-14T10:00:00.000Z',
                durability: 'durable',
                lifecycleDurability: 'durable',
                status: 'timed_out',
                delivery: {
                    status: 'handed_off',
                    dispatchedAt: '2026-08-14T10:00:01.000Z',
                    deadlineAt: '2026-08-14T10:00:02.000Z',
                },
                timedOutAt: terminalAt,
                reason: 'confirmation_not_received',
            },
            ...Array.from({ length: 20 }, (_, index) => ({
                commandId: `cmd-extra-${String(index).padStart(2, '0')}`,
                deviceId: 'led-main',
                commandType: 'set.power' as const,
                requestedState: { power: 'on' as const },
                requestedAt: '2026-08-14T09:00:00.000Z',
                durability: 'durable' as const,
                lifecycleDurability: 'durable' as const,
                status: 'failed' as const,
                failedAt: '2026-08-14T09:00:01.000Z',
                reason: 'device_rejected',
                message: 'The device rejected the command.',
            })),
        ] satisfies TerminalCommandProjection[];

        const selected = selectRecentCommands(commands);

        expect(selected).toHaveLength(20);
        expect(selected.slice(0, 3).map((command) => command.commandId)).toEqual([
            'cmd-z',
            'cmd-m',
            'cmd-a',
        ]);
        expect(selected.some((command) => command.commandId === 'cmd-extra-00')).toBe(false);
        expect(isRecentCommandsOrdered(selected)).toBe(true);
        expect(isRecentCommandsOrdered([...selected].reverse())).toBe(false);
    });
});
