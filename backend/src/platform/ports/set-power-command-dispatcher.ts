import type { SetPowerCommandRequest } from '@smart-room/contracts/commands';

export type PlatformSetPowerCommand = SetPowerCommandRequest & {
    commandId: string;
};

export type CommandDispatchResult =
    | { status: 'handed_off'; handedOffAt: string }
    | { status: 'not_handed_off'; reason: string; message: string }
    | { status: 'uncertain'; reason: string };

export interface SetPowerCommandDispatcher {
    dispatch(command: PlatformSetPowerCommand, attemptedAt?: string): CommandDispatchResult;
}
