import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './Dashboard.module.css';
import type { RenderableDeviceProjection } from './device-projection';
import { HistorySidebar } from './history-sidebar/HistorySidebar';
import { LedCard } from './led-card/LedCard';
import { TemperatureCard } from './temperature-card/TemperatureCard';
import { type RenderableRoomSnapshot, useRoom } from './useRoom';

export type { RenderableDeviceProjection } from './device-projection';

export interface DeviceControlExtension {
    readonly headerAction?: ReactNode;
    readonly interactionLocked?: boolean;
}

export function Dashboard({
    getDeviceExtension,
    renderOverlay,
}: {
    getDeviceExtension?(device: RenderableDeviceProjection): DeviceControlExtension | undefined;
    renderOverlay?(snapshot: RenderableRoomSnapshot | undefined): ReactNode;
}) {
    const { room, historySource } = useRoom();
    const { t } = useTranslation('dashboard');
    const snapshot = room.status === 'ready' ? room.snapshot : undefined;
    const realtimeUncertain =
        room.connectionStatus === 'reconnecting' || room.contractError !== undefined;

    return (
        <>
            <main className={styles.shell}>
                <HistorySidebar
                    source={historySource}
                    devices={snapshot?.devices ?? []}
                    realtimeUncertain={realtimeUncertain}
                    waitingForRoom={!snapshot}
                />
                <div className={styles.controls}>
                    {snapshot?.devices.map((device) => {
                        const extension = getDeviceExtension?.(device);

                        switch (device.role) {
                            case 'temperature-sensor':
                                return (
                                    <TemperatureCard
                                        key={device.deviceId}
                                        device={device}
                                        headerAction={extension?.headerAction}
                                        realtimeUncertain={realtimeUncertain}
                                    />
                                );

                            case 'led-output': {
                                const activeCommand = snapshot.activeCommands.find(
                                    (command) => command.deviceId === device.deviceId,
                                );
                                const recentCommand = snapshot.recentCommands.find(
                                    (command) => command.deviceId === device.deviceId,
                                );

                                return (
                                    <LedCard
                                        key={device.deviceId}
                                        device={device}
                                        activeCommand={activeCommand}
                                        recentCommand={recentCommand}
                                        headerAction={extension?.headerAction}
                                        interactionLocked={extension?.interactionLocked}
                                        realtimeUncertain={realtimeUncertain}
                                    />
                                );
                            }

                            default:
                                return null;
                        }
                    })}
                    {!snapshot ? (
                        <p>
                            {room.connectionStatus === 'reconnecting'
                                ? t('realtime.reconnecting')
                                : t('realtime.connecting')}
                        </p>
                    ) : null}
                </div>
            </main>
            {renderOverlay?.(snapshot)}
        </>
    );
}
