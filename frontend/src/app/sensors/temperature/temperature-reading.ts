import type { TemperatureSensorDeviceProjection } from '../../shared/room-rendering';

export interface TemperatureSensorReading {
    sensorId: string;
    sensorName: string;
    value?: number;
    unit?: 'celsius';
    recordedAt?: string;
    availability: TemperatureSensorDeviceProjection['availability'];
    availabilityReason?: string;
    health: TemperatureSensorDeviceProjection['health'];
    healthReason?: string;
    freshness: 'fresh' | 'stale' | 'unknown';
}

export function toTemperatureSensorReading(
    device: TemperatureSensorDeviceProjection,
): TemperatureSensorReading {
    const hasReading =
        typeof device.reportedState.temperature === 'number' &&
        device.reportedState.temperatureUnit === 'celsius' &&
        typeof device.observationStatus.temperature?.lastObservedAt === 'string';

    return {
        sensorId: device.deviceId,
        sensorName: device.name,
        ...(hasReading
            ? {
                  value: device.reportedState.temperature,
                  unit: device.reportedState.temperatureUnit,
                  recordedAt: device.observationStatus.temperature.lastObservedAt,
              }
            : {}),
        availability: device.availability,
        availabilityReason: device.availabilityReason,
        health: device.health,
        healthReason: device.healthReason,
        freshness: device.observationStatus.temperature.freshness,
    };
}
