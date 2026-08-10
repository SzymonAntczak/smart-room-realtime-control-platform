import type { DeviceProjection } from '@smart-room/contracts/projections';
import { useState } from 'react';

import { useRoomRealtime } from '../realtime/use-room-realtime';
import { type DeviceControlExtension, RoomControlSurface } from '../shared/ui/RoomControlSurface';

import { DevPanel, type DevPanelTarget } from './dev-panel';
import { ledScenarioDefinition, temperatureScenarioDefinition } from './scenarios';

export function AppDev() {
    const room = useRoomRealtime();
    const [scenarioTarget, setScenarioTarget] = useState<DevPanelTarget>();
    const [scenarioRequestCounts, setScenarioRequestCounts] = useState<ReadonlyMap<string, number>>(
        new Map(),
    );
    const snapshot = room.status === 'ready' ? room.snapshot : undefined;

    function getDeviceExtension(device: DeviceProjection): DeviceControlExtension | undefined {
        const target = toScenarioTarget(device);

        if (!target) {
            return undefined;
        }

        return {
            headerAction: (
                <DevPanel.Trigger
                    deviceId={device.deviceId}
                    expanded={scenarioTarget?.deviceId === device.deviceId}
                    onClick={() => setScenarioTarget(target)}
                />
            ),
            interactionLocked:
                target.definition.lockDeviceControlWhileRequest &&
                (scenarioRequestCounts.get(device.deviceId) ?? 0) > 0,
        };
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

    return (
        <>
            <RoomControlSurface room={room} getDeviceExtension={getDeviceExtension} />
            {scenarioTarget && snapshot ? (
                <DevPanel.Sidebar
                    key={scenarioTarget.deviceId}
                    target={scenarioTarget}
                    snapshot={snapshot}
                    onClose={closeScenarioSidebar}
                    onRequestChange={updateScenarioRequestCount}
                />
            ) : null}
        </>
    );
}

export function updateScenarioRequestCounts(
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

function toScenarioTarget(device: DeviceProjection): DevPanelTarget | undefined {
    switch (device.role) {
        case 'temperature-sensor':
            return { definition: temperatureScenarioDefinition, deviceId: device.deviceId };
        case 'led-output':
            return { definition: ledScenarioDefinition, deviceId: device.deviceId };
        default:
            return undefined;
    }
}
