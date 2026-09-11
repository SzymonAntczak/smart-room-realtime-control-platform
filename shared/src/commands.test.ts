import { describe, expect, it } from 'vitest';

import {
    acceptedCommandResponseSchema,
    commandDeliveryEvidenceSchema,
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

    it('requires both durability axes on admitted outcomes without claiming confirmation', () => {
        const accepted = {
            commandId: 'cmd-accepted',
            status: 'accepted',
            durability: 'durable',
            lifecycleDurability: 'durable',
        } as const;
        const rejected = {
            commandId: 'cmd-rejected',
            status: 'rejected',
            reason: 'command_already_active',
            message: 'The device already has an active command.',
            durability: 'volatile',
            lifecycleDurability: 'volatile',
        } as const;

        expect(isSchema(acceptedCommandResponseSchema, accepted)).toBe(true);
        expect(isSchema(rejectedCommandResponseSchema, rejected)).toBe(true);

        for (const outcome of [accepted, rejected]) {
            expect(
                isSchema(
                    outcome.status === 'accepted'
                        ? acceptedCommandResponseSchema
                        : rejectedCommandResponseSchema,
                    { ...outcome, confirmedAt: '2026-08-14T10:00:01.000Z' },
                ),
            ).toBe(false);
            expect(
                isSchema(
                    outcome.status === 'accepted'
                        ? acceptedCommandResponseSchema
                        : rejectedCommandResponseSchema,
                    Object.fromEntries(
                        Object.entries(outcome).filter(([field]) => field !== 'durability'),
                    ),
                ),
            ).toBe(false);
            expect(
                isSchema(
                    outcome.status === 'accepted'
                        ? acceptedCommandResponseSchema
                        : rejectedCommandResponseSchema,
                    Object.fromEntries(
                        Object.entries(outcome).filter(
                            ([field]) => field !== 'lifecycleDurability',
                        ),
                    ),
                ),
            ).toBe(false);
        }
    });

    it('keeps pre-admission errors outside command lifecycle and durability', () => {
        const outcomes = [
            { error: 'unknown_device', message: 'Unknown device.' },
            {
                error: 'platform_recovering',
                message: 'The platform is recovering.',
                retryable: true,
            },
        ] as const;

        for (const outcome of outcomes) {
            expect(isSchema(preAdmissionCommandErrorResponseSchema, outcome)).toBe(true);

            for (const forbiddenField of [
                'commandId',
                'status',
                'durability',
                'lifecycleDurability',
            ]) {
                expect(
                    isSchema(preAdmissionCommandErrorResponseSchema, {
                        ...outcome,
                        [forbiddenField]: 'must-not-exist',
                    }),
                ).toBe(false);
            }
        }

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

    it('distinguishes definite and uncertain delivery evidence', () => {
        const handedOff = {
            status: 'handed_off',
            dispatchedAt: '2026-08-14T10:00:01.000Z',
            deadlineAt: '2026-08-14T10:00:06.000Z',
        } as const;
        const uncertain = {
            status: 'uncertain',
            firstAttemptedAt: '2026-08-14T10:00:01.000Z',
            deadlineAt: '2026-08-14T10:00:06.000Z',
        } as const;

        expect(isSchema(commandDeliveryEvidenceSchema, handedOff)).toBe(true);
        expect(isSchema(commandDeliveryEvidenceSchema, uncertain)).toBe(true);
        expect(
            isSchema(commandDeliveryEvidenceSchema, { ...handedOff, firstAttemptedAt: 'x' }),
        ).toBe(false);
        expect(isSchema(commandDeliveryEvidenceSchema, { ...uncertain, dispatchedAt: 'x' })).toBe(
            false,
        );
        expect(
            isSchema(commandDeliveryEvidenceSchema, {
                status: 'handed_off',
                deadlineAt: handedOff.deadlineAt,
            }),
        ).toBe(false);
        expect(
            isSchema(commandDeliveryEvidenceSchema, {
                status: 'uncertain',
                firstAttemptedAt: uncertain.firstAttemptedAt,
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
