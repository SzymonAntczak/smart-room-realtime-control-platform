import type { DeviceState } from '@smart-room/contracts/devices';
import type { DeviceProjection } from '@smart-room/contracts/projections';

export interface TemperatureSensorReading {
    sensorId: string;
    sensorName: string;
    value: number;
    unit: 'celsius';
    recordedAt: string;
    health: DeviceProjection['health'];
}

export function toTemperatureSensorReading(device: DeviceProjection): TemperatureSensorReading {
    if (
        typeof device.reportedState.temperature !== 'number' ||
        device.reportedState.temperatureUnit !== 'celsius' ||
        typeof device.lastSeenAt !== 'string'
    ) {
        throw new Error('Temperature sensor data did not match the expected contract.');
    }
    const state = device.reportedState as DeviceState & {
        temperature: number;
        temperatureUnit: 'celsius';
    };
    return {
        sensorId: device.deviceId,
        sensorName: device.name,
        value: state.temperature,
        unit: state.temperatureUnit,
        recordedAt: device.lastSeenAt,
        health: device.health,
    };
}
