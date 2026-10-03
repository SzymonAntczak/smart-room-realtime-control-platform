import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { LedControl } from '../../controls/led/LedControl';
import { useRecentEventsSidebar } from '../../history/use-recent-events-sidebar';
import { UserHistoryPanel } from '../../history/UserHistoryPanel';
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
    const scrollRoot = useRef<HTMLElement | null>(null);
    const feedSidebar = useRecentEventsSidebar();
    const FeedToggleIcon = feedSidebar.isOpen ? PanelLeftClose : PanelLeftOpen;

    return (
        <main className={styles.shell} data-feed-open={feedSidebar.isOpen}>
            <div className={styles.sidebarSlot}>
                <div className={styles.sidebarViewport}>
                    <aside
                        ref={scrollRoot}
                        id="recent-events-sidebar"
                        aria-label={t('feed.heading')}
                        className={styles.sidebar}
                        aria-hidden={!feedSidebar.isOpen}
                        inert={!feedSidebar.isOpen}
                    >
                        {snapshot && feedSidebar.isOpen ? (
                            <UserHistoryPanel
                                source={room.historySource}
                                scrollRoot={scrollRoot}
                                devices={snapshot.devices}
                                realtimeUncertain={realtimeUncertain}
                            />
                        ) : (
                            <section
                                className={styles.sidebarLoading}
                                aria-labelledby="recent-events-heading"
                            >
                                <h2 id="recent-events-heading">{t('feed.heading')}</h2>
                                <p>{t('feed.connecting')}</p>
                            </section>
                        )}
                    </aside>
                </div>
                <button
                    type="button"
                    className={styles.sidebarToggle}
                    aria-controls="recent-events-sidebar"
                    aria-expanded={feedSidebar.isOpen}
                    aria-label={feedSidebar.isOpen ? t('feed.hideSidebar') : t('feed.showSidebar')}
                    onClick={feedSidebar.toggle}
                >
                    <FeedToggleIcon aria-hidden="true" size={22} strokeWidth={1.75} />
                </button>
            </div>
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
