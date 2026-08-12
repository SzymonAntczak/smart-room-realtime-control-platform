import type { SetPowerCommandRequest } from '@smart-room/contracts/commands';

export type PlatformSetPowerCommand = SetPowerCommandRequest & {
    commandId: string;
};

export interface SetPowerCommandDispatcher {
    dispatch(command: PlatformSetPowerCommand): void;
}
