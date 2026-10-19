import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { getDeviceDisplayName } from '../../features/device-display';
import { Alert } from '../../ui';

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
    const { t: deviceDetailsT } = useTranslation('deviceDetails');
    const location = useLocation();
    const mainRef = useRef<HTMLElement>(null);

    useEffect(() => {
        if (location.state?.focusDashboard === true) {
            mainRef.current?.focus();
        }
    }, [location.key, location.state]);

    const snapshot = room.status === 'ready' ? room.snapshot : undefined;
    const realtimeUncertain =
        room.connectionStatus === 'reconnecting' || room.contractError !== undefined;
    const storage = snapshot?.platform.storage;
    const storageWarning =
        storage?.status === 'degraded'
            ? t('storage.degraded', {
                  reason: storage.reason ? ` (${storage.reason})` : '',
              })
            : storage?.status === 'recovering'
              ? t('storage.recovering', {
                    reason: storage.reason ? ` (${storage.reason})` : '',
                })
              : undefined;

    return (
        <>
            {storageWarning ? (
                <div className={styles.storageWarning}>
                    <Alert message={storageWarning} variant="warning" />
                </div>
            ) : null}
            <main
                ref={mainRef}
                className={styles.shell}
                tabIndex={location.state?.focusDashboard === true ? -1 : undefined}
            >
                <HistorySidebar
                    source={historySource}
                    devices={snapshot?.devices ?? []}
                    realtimeUncertain={realtimeUncertain}
                    waitingForRoom={!snapshot}
                />
                <div className={styles.controls}>
                    {snapshot?.devices.map((device) => {
                        const extension = getDeviceExtension?.(device);
                        const deviceName = getDeviceDisplayName(device, (key) =>
                            t(key, { ns: 'dashboard' }),
                        );
                        const headerAction = (
                            <>
                                {extension?.headerAction}
                                <Link
                                    aria-label={deviceDetailsT('open', { name: deviceName })}
                                    to={`/device-details/${encodeURIComponent(device.deviceId)}`}
                                    viewTransition
                                    className={styles.detailsLink}
                                >
                                    <Info aria-hidden="true" size={18} />
                                </Link>
                            </>
                        );

                        switch (device.role) {
                            case 'temperature-sensor':
                                return (
                                    <TemperatureCard
                                        key={device.deviceId}
                                        device={device}
                                        headerAction={headerAction}
                                        realtimeUncertain={realtimeUncertain}
                                    />
                                );

                            case 'led-output': {
                                const activeCommand = snapshot.activeCommands.find(
                                    (command) => command.deviceId === device.deviceId,
                                );
                                const recentCommands = snapshot.recentCommands.filter(
                                    (command) => command.deviceId === device.deviceId,
                                );

                                return (
                                    <LedCard
                                        key={device.deviceId}
                                        device={device}
                                        activeCommand={activeCommand}
                                        recentCommands={recentCommands}
                                        headerAction={headerAction}
                                        interactionLocked={
                                            extension?.interactionLocked ||
                                            storage?.status === 'recovering'
                                        }
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
