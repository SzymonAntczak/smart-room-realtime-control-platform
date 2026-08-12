import type { DeviceRole } from '@smart-room/contracts/devices';
import type { DeviceProjection } from '@smart-room/contracts/projections';

export interface DeviceFreshnessThresholds {
    staleAfterMs: number;
}

export type FreshnessThresholdsByRole = Partial<Record<DeviceRole, DeviceFreshnessThresholds>>;

export function withFreshness(
    device: DeviceProjection,
    evaluatedAt: string,
    thresholdsByRole: FreshnessThresholdsByRole,
): DeviceProjection {
    const threshold = thresholdsByRole[device.role];

    if (!threshold) {
        return device;
    }

    const observationStatus = Object.fromEntries(
        Object.entries(device.observationStatus).map(([capability, status]) => {
            if (!status.lastObservedAt) {
                return [capability, status];
            }

            const freshness: 'fresh' | 'stale' =
                Date.parse(evaluatedAt) - Date.parse(status.lastObservedAt) > threshold.staleAfterMs
                    ? 'stale'
                    : 'fresh';

            return [capability, { ...status, freshness }];
        }),
    );

    return { ...device, observationStatus };
}
