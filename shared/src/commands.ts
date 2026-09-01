import { Type } from '@sinclair/typebox';

import type { PowerState } from './devices';
import { nonEmptyStringSchema } from './validation';

export const durabilityValues = ['durable', 'volatile'] as const;
export type Durability = (typeof durabilityValues)[number];

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
    durability: Durability;
    lifecycleDurability: Durability;
}
export interface RejectedCommandResponse {
    commandId: string;
    status: 'rejected';
    reason: string;
    message: string;
    durability: Durability;
    lifecycleDurability: Durability;
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
export type CommandDeliveryEvidence =
    | { status: 'handed_off'; dispatchedAt: string; deadlineAt: string }
    | { status: 'uncertain'; firstAttemptedAt: string; deadlineAt: string };
interface CommandProjectionBase {
    commandId: string;
    deviceId: string;
    commandType: 'set.power';
    requestedState: { power: PowerState };
    requestedAt: string;
    durability: Durability;
    lifecycleDurability: Durability;
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
        durability: Type.Union(durabilityValues.map((value) => Type.Literal(value))),
        lifecycleDurability: Type.Union(durabilityValues.map((value) => Type.Literal(value))),
    },
    { additionalProperties: false },
);
export const rejectedCommandResponseSchema = Type.Object(
    {
        commandId: nonEmptyStringSchema,
        status: Type.Literal('rejected'),
        reason: nonEmptyStringSchema,
        message: nonEmptyStringSchema,
        durability: Type.Union(durabilityValues.map((value) => Type.Literal(value))),
        lifecycleDurability: Type.Union(durabilityValues.map((value) => Type.Literal(value))),
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
