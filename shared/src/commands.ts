import type { PowerState } from './devices';

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
    requestedState: {
        power: PowerState;
    };
}

interface CommandProjectionBase {
    commandId: string;
    deviceId: string;
    commandType: 'set.power';
    requestedState: { power: PowerState };
    requestedAt: string;
    reason?: string;
    message?: string;
}

export type AcceptedCommandProjection = CommandProjectionBase & {
    status: 'accepted';
};

export type PendingCommandProjection = CommandProjectionBase & {
    status: 'pending';
    dispatchedAt: string;
};

export type ConfirmedCommandProjection = CommandProjectionBase & {
    status: 'confirmed';
    dispatchedAt: string;
    confirmedAt: string;
};

export type FailedCommandProjection = Omit<CommandProjectionBase, 'reason' | 'message'> & {
    status: 'failed';
    dispatchedAt?: string;
    failedAt: string;
    reason: string;
    message: string;
};

export type TimedOutCommandProjection = Omit<CommandProjectionBase, 'reason'> & {
    status: 'timed_out';
    dispatchedAt: string;
    timedOutAt: string;
    reason: string;
};

export type IdleCommandProjection = CommandProjectionBase & {
    status: 'idle';
};

export type ActiveCommandProjection = AcceptedCommandProjection | PendingCommandProjection;

export type TerminalCommandProjection =
    | ConfirmedCommandProjection
    | FailedCommandProjection
    | TimedOutCommandProjection;

export type CommandProjection =
    | ActiveCommandProjection
    | ConfirmedCommandProjection
    | FailedCommandProjection
    | TimedOutCommandProjection
    | IdleCommandProjection;
