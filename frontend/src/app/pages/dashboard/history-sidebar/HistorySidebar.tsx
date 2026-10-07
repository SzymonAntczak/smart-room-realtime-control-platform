import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { RenderableDeviceProjection } from '../device-projection';
import type { RoomHistorySource } from '../room-history-source';

import { HistorySidebarContent } from './history-sidebar-content/HistorySidebarContent';
import styles from './HistorySidebar.module.css';
import { useHistorySidebar } from './useHistorySidebar';

export function HistorySidebar({
    source,
    devices,
    realtimeUncertain,
    waitingForRoom,
}: {
    source: RoomHistorySource;
    devices: readonly RenderableDeviceProjection[];
    realtimeUncertain: boolean;
    waitingForRoom: boolean;
}) {
    const { t } = useTranslation('dashboard');
    const sidebar = useHistorySidebar();
    const SidebarToggleIcon = sidebar.isOpen ? PanelLeftClose : PanelLeftOpen;

    return (
        <div className={styles.sidebarSlot} data-history-sidebar-open={sidebar.isOpen}>
            <div className={styles.sidebarViewport}>
                <aside
                    id="history-sidebar"
                    aria-label={t('history.title')}
                    className={styles.sidebar}
                    aria-hidden={!sidebar.isOpen}
                    inert={!sidebar.isOpen}
                >
                    {sidebar.isOpen ? (
                        <HistorySidebarContent
                            source={source}
                            devices={devices}
                            realtimeUncertain={realtimeUncertain}
                            waitingForRoom={waitingForRoom}
                        />
                    ) : (
                        <h2 className={styles.sidebarHeading}>{t('history.title')}</h2>
                    )}
                </aside>
            </div>
            <button
                type="button"
                className={styles.sidebarToggle}
                aria-controls="history-sidebar"
                aria-expanded={sidebar.isOpen}
                aria-label={sidebar.isOpen ? t('feed.hideSidebar') : t('feed.showSidebar')}
                onClick={sidebar.toggle}
            >
                <SidebarToggleIcon aria-hidden="true" size={22} strokeWidth={1.75} />
            </button>
        </div>
    );
}
