import type { DeviceProjection } from '@smart-room/contracts/projections';

export type ExpectedIntervalsMsByCapability = Partial<Record<'temperature' | 'power', number>>;

export function withFreshness(
    device: DeviceProjection,
    evaluatedAt: string,
    expectedIntervalMsByCapability: ExpectedIntervalsMsByCapability | undefined,
): DeviceProjection {
    const observationStatus = Object.fromEntries(
        Object.entries(device.observationStatus).map(([capability, status]) => {
            const expectedIntervalMs =
                expectedIntervalMsByCapability?.[
                    capability as keyof ExpectedIntervalsMsByCapability
                ];

            if (expectedIntervalMs === undefined || !status.lastObservedAt) {
                return [capability, { ...status, freshness: 'unknown' as const }];
            }

            const freshness: 'fresh' | 'stale' =
                Date.parse(evaluatedAt) - Date.parse(status.lastObservedAt) > expectedIntervalMs * 3
                    ? 'stale'
                    : 'fresh';

            return [capability, { ...status, freshness }];
        }),
    );

    return { ...device, observationStatus };
}
