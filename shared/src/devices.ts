export const deviceHealthStates = ['online', 'stale', 'offline', 'degraded'] as const;

export type DeviceHealth = (typeof deviceHealthStates)[number];

export const deviceRoles = [
    'temperature-sensor',
    'humidity-sensor',
    'motion-sensor',
    'ambient-light-sensor',
    'led-output',
] as const;

export type DeviceRole = (typeof deviceRoles)[number];

export type PowerState = 'on' | 'off';

export const commandAvailabilityPolicies = ['allow', 'allow_with_warning', 'block'] as const;

export type CommandAvailabilityPolicy = (typeof commandAvailabilityPolicies)[number];

export type DeviceStateValue = string | number | boolean;

export type DeviceState = Record<string, DeviceStateValue>;

export interface CommandAvailability {
    policy: CommandAvailabilityPolicy;
    reason?: string;
}
