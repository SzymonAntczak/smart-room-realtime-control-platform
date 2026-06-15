import type {
    CommandAvailability,
    CommandAvailabilityPolicy,
    DeviceHealth,
    DeviceProjection,
    DeviceRole,
    DeviceState,
} from '../../../../../shared/src/contracts';

const defaultRoomBffUrl = 'http://localhost:4310';

export type TemperatureSnapshotResult =
    | {
          status: 'ready';
          reading: TemperatureSensorReading;
      }
    | {
          status: 'empty';
      };

export interface TemperatureSensorReading {
    sensorName: string;
    value: number;
    unit: 'celsius';
    recordedAt: string;
    health: DeviceProjection['health'];
}

export async function loadTemperatureSnapshot(): Promise<TemperatureSnapshotResult> {
    const response = await fetch(`${getRoomBffUrl()}/room`);

    if (!response.ok) {
        throw new Error(`Room snapshot request failed with status ${response.status}.`);
    }

    const body: unknown = await response.json();

    if (!isRoomSnapshotWithDevices(body)) {
        throw new Error('Room snapshot response did not match the expected contract.');
    }

    return toTemperatureSnapshotResult(body);
}

function getRoomBffUrl(): string {
    return import.meta.env.VITE_ROOM_BFF_URL ?? defaultRoomBffUrl;
}

interface RoomSnapshotWithDevices {
    devices: DeviceProjection[];
}

function toTemperatureSnapshotResult(snapshot: RoomSnapshotWithDevices): TemperatureSnapshotResult {
    const temperatureDevice = snapshot.devices.find(
        (device) => device.role === 'temperature-sensor',
    );

    if (!temperatureDevice) {
        return {
            status: 'empty',
        };
    }

    if (!isRenderableTemperatureDevice(temperatureDevice)) {
        throw new Error('Temperature sensor data did not match the expected contract.');
    }

    return {
        status: 'ready',
        reading: {
            sensorName: temperatureDevice.name,
            value: temperatureDevice.reportedState.temperature,
            unit: temperatureDevice.reportedState.temperatureUnit,
            recordedAt: temperatureDevice.lastSeenAt,
            health: temperatureDevice.health,
        },
    };
}

function isRoomSnapshotWithDevices(value: unknown): value is RoomSnapshotWithDevices {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.roomName === 'string' &&
        typeof value.updatedAt === 'string' &&
        Array.isArray(value.devices) &&
        value.devices.every(isDeviceProjection) &&
        Array.isArray(value.activeCommands) &&
        Array.isArray(value.recentEvents)
    );
}

function isDeviceProjection(value: unknown): value is DeviceProjection {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.deviceId === 'string' &&
        typeof value.name === 'string' &&
        isDeviceRole(value.role) &&
        isDeviceHealth(value.health) &&
        isDeviceState(value.reportedState) &&
        isCommandAvailability(value.commandAvailability) &&
        (value.lastSeenAt === undefined || typeof value.lastSeenAt === 'string')
    );
}

function isRenderableTemperatureDevice(device: DeviceProjection): device is DeviceProjection & {
    lastSeenAt: string;
    reportedState: DeviceState & {
        temperature: number;
        temperatureUnit: 'celsius';
    };
} {
    return (
        typeof device.reportedState.temperature === 'number' &&
        device.reportedState.temperatureUnit === 'celsius' &&
        typeof device.lastSeenAt === 'string'
    );
}

function isDeviceRole(value: unknown): value is DeviceRole {
    return (
        value === 'temperature-sensor' ||
        value === 'humidity-sensor' ||
        value === 'motion-sensor' ||
        value === 'ambient-light-sensor' ||
        value === 'led-output'
    );
}

function isDeviceHealth(value: unknown): value is DeviceHealth {
    return value === 'online' || value === 'stale' || value === 'offline' || value === 'degraded';
}

function isCommandAvailability(value: unknown): value is CommandAvailability {
    if (!isRecord(value)) {
        return false;
    }

    return (
        isCommandAvailabilityPolicy(value.policy) &&
        (value.reason === undefined || typeof value.reason === 'string')
    );
}

function isCommandAvailabilityPolicy(value: unknown): value is CommandAvailabilityPolicy {
    return value === 'allow' || value === 'allow_with_warning' || value === 'block';
}

function isDeviceState(value: unknown): value is DeviceState {
    if (!isRecord(value)) {
        return false;
    }

    return Object.values(value).every(isDeviceStateValue);
}

function isDeviceStateValue(value: unknown): value is DeviceState[keyof DeviceState] {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
