import type { DeviceState, PowerState } from './devices';

export type CommandStatus = 'idle' | 'pending' | 'confirmed' | 'failed' | 'timed_out';

export type CommandType = 'set.power';

export type CommandRequestedBy = 'user' | 'automation';

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
