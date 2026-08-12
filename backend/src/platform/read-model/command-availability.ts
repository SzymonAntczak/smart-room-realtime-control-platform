import type {
    CommandAvailability,
    DeviceAvailability,
    DeviceOperationalHealth,
    DeviceRole,
} from '@smart-room/contracts/devices';

export function commandAvailabilityFor(
    role: DeviceRole,
    availability: DeviceAvailability,
    health: DeviceOperationalHealth,
    healthReason?: string,
): CommandAvailability {
    if (role !== 'led-output') {
        return { policy: 'block', reason: 'read_only_device' };
    }

    if (availability === 'offline') {
        return { policy: 'block', reason: 'device_offline' };
    }

    if (availability === 'unknown') {
        return { policy: 'block', reason: 'availability_unknown' };
    }

    if (health !== 'degraded') {
        return { policy: 'allow' };
    }

    return healthReason === 'command_blocked'
        ? { policy: 'block', reason: 'device_degraded' }
        : { policy: 'allow_with_warning', reason: 'device_degraded' };
}
