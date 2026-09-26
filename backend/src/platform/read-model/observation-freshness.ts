import type { DeviceProjection } from '@smart-room/contracts/projections';

export function withFreshness(
    device: DeviceProjection,
    evaluatedAt: string,
    expectedIntervalMs: number | undefined,
): DeviceProjection {
    if (expectedIntervalMs === undefined) {
        return device;
    }

    const staleAfterMs = expectedIntervalMs * 3;

    const observationStatus = Object.fromEntries(
        Object.entries(device.observationStatus).map(([capability, status]) => {
            if (!status.lastObservedAt) {
                return [capability, status];
            }

            const freshness: 'fresh' | 'stale' =
                Date.parse(evaluatedAt) - Date.parse(status.lastObservedAt) > staleAfterMs
                    ? 'stale'
                    : 'fresh';

            return [capability, { ...status, freshness }];
        }),
    );

    return { ...device, observationStatus };
}
