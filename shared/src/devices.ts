export type DeviceHealth = 'online' | 'stale' | 'offline' | 'degraded';

export type DeviceRole =
    | 'temperature-sensor'
    | 'humidity-sensor'
    | 'motion-sensor'
    | 'ambient-light-sensor'
    | 'led-output';

export type PowerState = 'on' | 'off';

export type CommandAvailabilityPolicy = 'allow' | 'allow_with_warning' | 'block';

export type DeviceStateValue = string | number | boolean;

export type DeviceState = Record<string, DeviceStateValue>;

export interface CommandAvailability {
    policy: CommandAvailabilityPolicy;
    reason?: string;
}
