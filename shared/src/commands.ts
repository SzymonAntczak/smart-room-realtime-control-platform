import type { DeviceState, PowerState } from './devices';

export const commandStatuses = ['idle', 'pending', 'confirmed', 'failed', 'timed_out'] as const;

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

export interface CommandProjection {
    commandId: string;
    deviceId: string;
    commandType: CommandType;
    status: CommandStatus;
    requestedState: DeviceState;
    requestedAt: string;
    dispatchedAt?: string;
    confirmedAt?: string;
    failedAt?: string;
    timedOutAt?: string;
    reason?: string;
    message?: string;
}
