import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { LedControl } from '../../controls/led/LedControl';
import type { RoomRealtimeState } from '../../realtime/use-room-realtime';
import { TemperatureControl } from '../../sensors/temperature/TemperatureControl';
import type { RenderableDeviceProjection } from '../room-rendering';

import styles from './RoomControlSurface.module.css';

export interface DeviceControlExtension {
    readonly headerAction?: ReactNode;
    readonly interactionLocked?: boolean;
}

export function RoomControlSurface({
    room,
    getDeviceExtension,
}: {
    room: RoomRealtimeState;
    getDeviceExtension?(device: RenderableDeviceProjection): DeviceControlExtension | undefined;
}) {
    const { t } = useTranslation('dashboard');
    const snapshot = room.status === 'ready' ? room.snapshot : undefined;
    const realtimeUncertain =
        room.connectionStatus === 'reconnecting' || room.contractError !== undefined;

    return (
        <main className={styles.shell}>
            <div className={styles.controls}>
                {snapshot?.devices.map((device) => {
                    const extension = getDeviceExtension?.(device);

                    switch (device.role) {
                        case 'temperature-sensor':
                            return (
                                <TemperatureControl
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
                                <LedControl
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
    );
}
