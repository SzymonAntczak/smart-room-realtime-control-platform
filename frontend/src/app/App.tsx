import type { DeviceProjection } from '@smart-room/contracts/projections';
import { type ReactNode, useState } from 'react';

import styles from './App.module.css';
import { LedControl } from './controls/led/LedControl';
import type { DeviceScenarioTarget } from './dev/device-scenarios/device-scenario-target';
import { DeviceScenarioSidebar } from './dev/device-scenarios/DeviceScenarioSidebar';
import { useRoomRealtime } from './realtime/use-room-realtime';
import { TemperatureControl } from './sensors/temperature/TemperatureControl';

interface AppProps {
    readonly showDevScenarioPanel?: boolean;
}

export function App({ showDevScenarioPanel = import.meta.env.DEV }: AppProps) {
    const room = useRoomRealtime();
    const [scenarioTarget, setScenarioTarget] = useState<DeviceScenarioTarget>();
    const [selectingLedScenarioDeviceId, setSelectingLedScenarioDeviceId] = useState<string>();
    const snapshot = room.status === 'ready' ? room.snapshot : undefined;
    const devicesById = snapshot
        ? new Map(snapshot.devices.map((device) => [device.deviceId, device]))
        : undefined;
    const realtimeUncertain =
        room.connectionStatus === 'reconnecting' || room.contractError !== undefined;
    const sidebarTarget =
        scenarioTarget?.kind === 'temperature'
            ? {
                  ...scenarioTarget,
                  telemetryUnavailable:
                      devicesById?.get(scenarioTarget.deviceId)?.availability === 'offline',
              }
            : scenarioTarget?.kind === 'led'
              ? {
                    ...scenarioTarget,
                    isCommandActive:
                        snapshot?.activeCommands.some(
                            (command) => command.deviceId === scenarioTarget.deviceId,
                        ) ?? false,
                }
              : undefined;
    const deviceRenderers: Partial<
        Record<DeviceProjection['role'], (device: DeviceProjection) => ReactNode>
    > = {
        'temperature-sensor': (device) => (
            <TemperatureControl
                key={device.deviceId}
                device={device}
                showDevScenarioPanel={showDevScenarioPanel}
                activeDevScenarioDeviceId={scenarioTarget?.deviceId}
                onOpenDevScenario={setScenarioTarget}
                realtimeUncertain={realtimeUncertain}
            />
        ),
        'led-output': (device) => {
            const activeCommand = snapshot?.activeCommands.find(
                (command) => command.deviceId === device.deviceId,
            );
            const recentCommand = snapshot?.recentCommands.find(
                (command) => command.deviceId === device.deviceId,
            );
            return (
                <LedControl
                    key={device.deviceId}
                    device={device}
                    activeCommand={activeCommand}
                    recentCommand={recentCommand}
                    showDevScenarioPanel={showDevScenarioPanel}
                    activeDevScenarioDeviceId={scenarioTarget?.deviceId}
                    isSelectingScenario={selectingLedScenarioDeviceId === device.deviceId}
                    onOpenDevScenario={setScenarioTarget}
                    realtimeUncertain={realtimeUncertain}
                />
            );
        },
    };

    function closeScenarioSidebar(): void {
        const triggerId = scenarioTarget ? `dev-scenarios-${scenarioTarget.deviceId}` : undefined;
        setScenarioTarget(undefined);
        queueMicrotask(() => document.getElementById(triggerId ?? '')?.focus());
    }

    return (
        <main className={styles.shell}>
            <div className={styles.controls}>
                {snapshot?.devices.map((device) => deviceRenderers[device.role]?.(device) ?? null)}
                {!snapshot ? (
                    <p>
                        {room.connectionStatus === 'reconnecting'
                            ? 'Reconnecting to realtime room stream...'
                            : 'Connecting to realtime room stream...'}
                    </p>
                ) : null}
            </div>
            {showDevScenarioPanel ? (
                <DeviceScenarioSidebar
                    target={sidebarTarget}
                    onClose={closeScenarioSidebar}
                    onLedScenarioRequestChange={(deviceId, isPending) =>
                        setSelectingLedScenarioDeviceId(isPending ? deviceId : undefined)
                    }
                />
            ) : null}
        </main>
    );
}
