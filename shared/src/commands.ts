import { type Static, Type } from '@sinclair/typebox';

import type { PowerState } from './devices';
import { type CommandDurability, commandDurabilitySchema } from './storage';
import { isoTimestampSchema, nonEmptyStringSchema } from './validation';

export { durabilityValues } from './storage';
export type Durability = CommandDurability;

export const commandTypes = ['set.power'] as const;
export type CommandType = (typeof commandTypes)[number];
export const commandRequestedByValues = ['user', 'automation'] as const;
export type CommandRequestedBy = (typeof commandRequestedByValues)[number];

export interface SetPowerCommandRequest {
    deviceId: string;
    commandType: 'set.power';
    requestedState: { power: PowerState };
}
export interface AcceptedCommandResponse {
    commandId: string;
    status: 'accepted';
    durability: CommandDurability;
    lifecycleDurability: CommandDurability;
}
export interface RejectedCommandResponse {
    commandId: string;
    status: 'rejected';
    reason: string;
    message: string;
    durability: CommandDurability;
    lifecycleDurability: CommandDurability;
}
interface PreAdmissionCommandErrorResponseBase {
    message: string;
    /** Type-only convenience for callers that handle all HTTP outcomes together. */
    commandId?: never;
    status?: never;
}
export type PreAdmissionCommandErrorResponse =
    | (PreAdmissionCommandErrorResponseBase & {
          error: 'unknown_device';
          retryable?: never;
      })
    | (PreAdmissionCommandErrorResponseBase & {
          error: 'platform_recovering';
          retryable: true;
      });
export const commandDeliveryEvidenceSchema = Type.Union([
    Type.Object(
        {
            status: Type.Literal('handed_off'),
            dispatchedAt: isoTimestampSchema,
            deadlineAt: isoTimestampSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            status: Type.Literal('uncertain'),
            firstAttemptedAt: isoTimestampSchema,
            deadlineAt: isoTimestampSchema,
        },
        { additionalProperties: false },
    ),
]);
export type CommandDeliveryEvidence = Static<typeof commandDeliveryEvidenceSchema>;
interface CommandProjectionBase {
    commandId: string;
    deviceId: string;
    commandType: 'set.power';
    requestedState: { power: PowerState };
    requestedAt: string;
    durability: CommandDurability;
    lifecycleDurability: CommandDurability;
}
export type AcceptedCommandProjection = CommandProjectionBase & { status: 'accepted' };
export type PendingCommandProjection = CommandProjectionBase & {
    status: 'pending';
    delivery: CommandDeliveryEvidence;
};
export type ConfirmedCommandProjection = CommandProjectionBase & {
    status: 'confirmed';
    delivery: CommandDeliveryEvidence;
    confirmedAt: string;
};
export type FailedCommandProjection = CommandProjectionBase & {
    status: 'failed';
    delivery?: CommandDeliveryEvidence;
    failedAt: string;
    reason: string;
    message: string;
};
export type TimedOutCommandProjection = CommandProjectionBase & {
    status: 'timed_out';
    delivery: CommandDeliveryEvidence;
    timedOutAt: string;
    reason: string;
};
export type ActiveCommandProjection = AcceptedCommandProjection | PendingCommandProjection;
export type TerminalCommandProjection =
    | ConfirmedCommandProjection
    | FailedCommandProjection
    | TimedOutCommandProjection;

/** Canonical terminal time for the discriminated command lifecycle. */
export function terminalCommandTimestamp(command: TerminalCommandProjection): string {
    switch (command.status) {
        case 'confirmed':
            return command.confirmedAt;
        case 'failed':
            return command.failedAt;
        case 'timed_out':
            return command.timedOutAt;
    }
}

/** Deterministic cache order: terminal time descending, then command ID descending. */
export function compareTerminalCommandsDescending(
    left: TerminalCommandProjection,
    right: TerminalCommandProjection,
): number {
    const timestampOrder =
        Date.parse(terminalCommandTimestamp(right)) - Date.parse(terminalCommandTimestamp(left));

    if (timestampOrder !== 0) {
        return timestampOrder;
    }

    if (left.commandId === right.commandId) {
        return 0;
    }

    return left.commandId > right.commandId ? -1 : 1;
}

/** Returns the bounded canonical recent-command cache without concealing duplicates. */
export function selectRecentCommands(
    commands: readonly TerminalCommandProjection[],
): TerminalCommandProjection[] {
    return [...commands].sort(compareTerminalCommandsDescending).slice(0, 20);
}

export function isRecentCommandsOrdered(commands: readonly TerminalCommandProjection[]): boolean {
    return commands.every((command, index) => {
        const next = commands[index + 1];

        return next === undefined || compareTerminalCommandsDescending(command, next) <= 0;
    });
}

export const powerStateSchema = Type.Union([Type.Literal('on'), Type.Literal('off')]);
export const powerStateProjectionSchema = Type.Object(
    { power: powerStateSchema },
    { additionalProperties: false },
);
export const setPowerCommandRequestSchema = Type.Object(
    {
        deviceId: nonEmptyStringSchema,
        commandType: Type.Literal('set.power'),
        requestedState: powerStateProjectionSchema,
    },
    { additionalProperties: false },
);
export const acceptedCommandResponseSchema = Type.Object(
    {
        commandId: nonEmptyStringSchema,
        status: Type.Literal('accepted'),
        durability: commandDurabilitySchema,
        lifecycleDurability: commandDurabilitySchema,
    },
    { additionalProperties: false },
);
export const rejectedCommandResponseSchema = Type.Object(
    {
        commandId: nonEmptyStringSchema,
        status: Type.Literal('rejected'),
        reason: nonEmptyStringSchema,
        message: nonEmptyStringSchema,
        durability: commandDurabilitySchema,
        lifecycleDurability: commandDurabilitySchema,
    },
    { additionalProperties: false },
);
export const preAdmissionCommandErrorResponseSchema = Type.Union([
    Type.Object(
        {
            error: Type.Literal('unknown_device'),
            message: nonEmptyStringSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            error: Type.Literal('platform_recovering'),
            message: nonEmptyStringSchema,
            retryable: Type.Literal(true),
        },
        { additionalProperties: false },
    ),
]);
