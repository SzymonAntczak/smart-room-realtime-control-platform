export const deviceAvailabilityStates = ['online', 'offline', 'unknown'] as const;

export type DeviceAvailability = (typeof deviceAvailabilityStates)[number];

export const deviceOperationalHealthStates = ['healthy', 'degraded', 'unknown'] as const;
export type DeviceOperationalHealth = (typeof deviceOperationalHealthStates)[number];

export const observationFreshnessStates = ['fresh', 'stale', 'unknown'] as const;
export type ObservationFreshness = (typeof observationFreshnessStates)[number];

export const deviceRoles = ['temperature-sensor', 'led-output'] as const;

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
