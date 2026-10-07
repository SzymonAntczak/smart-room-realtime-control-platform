import { useState } from 'react';

import type { DevPanelTarget } from './dev-panel';

export function useAppDev() {
    const [scenarioTarget, setScenarioTarget] = useState<DevPanelTarget>();
    const [scenarioRequestCounts, setScenarioRequestCounts] = useState<ReadonlyMap<string, number>>(
        new Map(),
    );

    function openScenarioSidebar(target: DevPanelTarget): void {
        setScenarioTarget(target);
    }

    function closeScenarioSidebar(): void {
        const triggerId = scenarioTarget ? `dev-scenarios-${scenarioTarget.deviceId}` : undefined;

        setScenarioTarget(undefined);
        queueMicrotask(() => document.getElementById(triggerId ?? '')?.focus());
    }

    function updateScenarioRequestCount(deviceId: string, isPending: boolean): void {
        setScenarioRequestCounts((current) =>
            updateScenarioRequestCounts(current, deviceId, isPending),
        );
    }

    function isDeviceControlLocked(deviceId: string, lockWhileRequestIsPending: boolean): boolean {
        return lockWhileRequestIsPending && (scenarioRequestCounts.get(deviceId) ?? 0) > 0;
    }

    return {
        closeScenarioSidebar,
        isDeviceControlLocked,
        openScenarioSidebar,
        scenarioTarget,
        updateScenarioRequestCount,
    };
}

function updateScenarioRequestCounts(
    current: ReadonlyMap<string, number>,
    deviceId: string,
    isPending: boolean,
): ReadonlyMap<string, number> {
    const count = current.get(deviceId) ?? 0;
    const nextCount = isPending ? count + 1 : Math.max(0, count - 1);
    const next = new Map(current);

    if (nextCount === 0) {
        next.delete(deviceId);
    } else {
        next.set(deviceId, nextCount);
    }

    return next;
}
