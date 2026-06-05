import type {
    CommandProjection,
    DeviceProjection,
    EventFeedItemProjection,
    PowerState,
    RoomSnapshotProjection,
    SetPowerCommandRequest,
} from '../../../../shared/src/contracts';

export type {
    CommandAvailability,
    CommandAvailabilityPolicy,
    CommandProjection,
    CommandStatus,
    DeviceHealth,
    DeviceProjection,
    DeviceRole,
    DeviceState,
    EventFeedItemProjection,
    PlatformEventSource,
    PlatformEventType,
    PowerState,
    SetPowerCommandRequest,
} from '../../../../shared/src/contracts';

export type ConnectionStatus = 'fixture' | 'connecting' | 'connected' | 'disconnected';

export interface RoomSnapshotView extends RoomSnapshotProjection {
    connectionStatus: ConnectionStatus;
}

export type RoomDeviceView = DeviceProjection;
export type RoomCommandView = CommandProjection;
export type RoomEventFeedItemView = EventFeedItemProjection;

export function createSetPowerCommandRequest(
    deviceId: string,
    power: PowerState,
): SetPowerCommandRequest {
    return {
        deviceId,
        commandType: 'set.power',
        requestedState: { power },
    };
}
