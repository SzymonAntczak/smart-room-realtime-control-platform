import { Type } from '@sinclair/typebox';

import type { PowerState } from './devices';
import { nonEmptyStringSchema } from './validation';

export const commandStatuses = [
    'idle',
    'accepted',
    'pending',
    'confirmed',
    'failed',
    'timed_out',
] as const;
export type CommandStatus = (typeof commandStatuses)[number];
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
}
export interface RejectedCommandResponse {
    commandId: string;
    status: 'rejected';
    reason: string;
    message: string;
}
interface CommandProjectionBase {
    commandId: string;
    deviceId: string;
    commandType: 'set.power';
    requestedState: { power: PowerState };
    requestedAt: string;
}
export type AcceptedCommandProjection = CommandProjectionBase & { status: 'accepted' };
export type PendingCommandProjection = CommandProjectionBase & {
    status: 'pending';
    dispatchedAt: string;
};
export type ConfirmedCommandProjection = CommandProjectionBase & {
    status: 'confirmed';
    dispatchedAt: string;
    confirmedAt: string;
};
export type FailedCommandProjection = CommandProjectionBase & {
    status: 'failed';
    dispatchedAt?: string;
    failedAt: string;
    reason: string;
    message: string;
};
export type TimedOutCommandProjection = CommandProjectionBase & {
    status: 'timed_out';
    dispatchedAt: string;
    timedOutAt: string;
    reason: string;
};
export type IdleCommandProjection = CommandProjectionBase & { status: 'idle' };
export type ActiveCommandProjection = AcceptedCommandProjection | PendingCommandProjection;
export type TerminalCommandProjection =
    | ConfirmedCommandProjection
    | FailedCommandProjection
    | TimedOutCommandProjection;
export type CommandProjection =
    | ActiveCommandProjection
    | TerminalCommandProjection
    | IdleCommandProjection;

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
    { commandId: nonEmptyStringSchema, status: Type.Literal('accepted') },
    { additionalProperties: false },
);
export const rejectedCommandResponseSchema = Type.Object(
    {
        commandId: nonEmptyStringSchema,
        status: Type.Literal('rejected'),
        reason: nonEmptyStringSchema,
        message: nonEmptyStringSchema,
    },
    { additionalProperties: false },
);
