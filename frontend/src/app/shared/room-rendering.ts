import type { PowerState } from '@smart-room/contracts/devices';
import type { DeviceProjection, RoomSnapshotProjection } from '@smart-room/contracts/projections';

type ObservationStatus = DeviceProjection['observationStatus'][string];

export interface LedDeviceProjection extends Omit<
    DeviceProjection,
    'observationStatus' | 'reportedState' | 'role'
> {
    readonly role: 'led-output';
    readonly reportedState: DeviceProjection['reportedState'] & { readonly power?: PowerState };
    readonly observationStatus: DeviceProjection['observationStatus'] & {
        readonly power?: ObservationStatus;
    };
}

export interface TemperatureSensorDeviceProjection extends Omit<
    DeviceProjection,
    'observationStatus' | 'reportedState' | 'role'
> {
    readonly role: 'temperature-sensor';
    readonly reportedState: DeviceProjection['reportedState'] & {
        readonly temperature?: number;
        readonly temperatureUnit?: 'celsius';
    };
    readonly observationStatus: DeviceProjection['observationStatus'] & {
        readonly temperature: ObservationStatus;
    };
}

export type RenderableDeviceProjection = LedDeviceProjection | TemperatureSensorDeviceProjection;

export interface RenderableRoomSnapshot extends Omit<RoomSnapshotProjection, 'devices'> {
    readonly devices: RenderableDeviceProjection[];
}

export function toRenderableRoomSnapshot(snapshot: RoomSnapshotProjection): RenderableRoomSnapshot {
    return {
        ...snapshot,
        devices: snapshot.devices.flatMap((device) => {
            const renderableDevice = toRenderableDeviceProjection(device);

            return renderableDevice ? [renderableDevice] : [];
        }),
    };
}

function toRenderableDeviceProjection(
    device: DeviceProjection,
): RenderableDeviceProjection | undefined {
    switch (device.role) {
        case 'led-output':
            return toLedDeviceProjection(device);
        case 'temperature-sensor':
            return toTemperatureSensorDeviceProjection(device);
        default:
            return undefined;
    }
}

function toLedDeviceProjection(device: DeviceProjection): LedDeviceProjection {
    const power = device.reportedState.power;

    if (power !== undefined && power !== 'on' && power !== 'off') {
        throw new Error('LED data did not match the expected rendering contract.');
    }

    return {
        ...device,
        role: 'led-output',
        reportedState: { ...device.reportedState, ...(power === undefined ? {} : { power }) },
    };
}

function toTemperatureSensorDeviceProjection(
    device: DeviceProjection,
): TemperatureSensorDeviceProjection {
    const observation = device.observationStatus.temperature;
    const temperature = device.reportedState.temperature;
    const temperatureUnit = device.reportedState.temperatureUnit;
    const hasTemperatureState = temperature !== undefined || temperatureUnit !== undefined;

    if (
        !observation ||
        (hasTemperatureState &&
            (typeof temperature !== 'number' ||
                temperatureUnit !== 'celsius' ||
                observation.lastObservedAt === undefined))
    ) {
        throw new Error('Temperature sensor data did not match the expected rendering contract.');
    }

    return {
        ...device,
        role: 'temperature-sensor',
        observationStatus: { ...device.observationStatus, temperature: observation },
    };
}
