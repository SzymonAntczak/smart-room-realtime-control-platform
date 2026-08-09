import type { DeviceState } from '@smart-room/contracts/devices';
import type { DeviceProjection } from '@smart-room/contracts/projections';

export interface TemperatureSensorReading {
    sensorId: string;
    sensorName: string;
    value?: number;
    unit?: 'celsius';
    recordedAt?: string;
    availability: DeviceProjection['availability'];
    availabilityReason?: string;
    health: DeviceProjection['health'];
    healthReason?: string;
    freshness: 'fresh' | 'stale' | 'unknown';
}

export function toTemperatureSensorReading(device: DeviceProjection): TemperatureSensorReading {
    const hasReading =
        typeof device.reportedState.temperature === 'number' &&
        device.reportedState.temperatureUnit === 'celsius' &&
        typeof device.observationStatus.temperature?.lastObservedAt === 'string';
    const state = device.reportedState as DeviceState & {
        temperature: number;
        temperatureUnit: 'celsius';
    };

    return {
        sensorId: device.deviceId,
        sensorName: device.name,
        ...(hasReading
            ? {
                  value: state.temperature,
                  unit: state.temperatureUnit,
                  recordedAt: device.observationStatus.temperature?.lastObservedAt,
              }
            : {}),
        availability: device.availability,
        availabilityReason: device.availabilityReason,
        health: device.health,
        healthReason: device.healthReason,
        freshness: device.observationStatus.temperature.freshness,
    };
}
