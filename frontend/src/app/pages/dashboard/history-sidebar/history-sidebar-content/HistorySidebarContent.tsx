import { ArrowUp, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { HistoryFeed, type HistoryLiveSource, HistoryProvider } from '../../../../features/history';
import { Button } from '../../../../ui';
import type { RenderableDeviceProjection } from '../../device-projection';
import { HistorySearchModal } from '../history-search-modal/HistorySearchModal';

import styles from './HistorySidebarContent.module.css';
import { useHistorySidebarContent } from './useHistorySidebarContent';

export function HistorySidebarContent({
    source,
    devices,
    realtimeUncertain,
    waitingForRoom,
}: {
    source: HistoryLiveSource;
    devices: readonly RenderableDeviceProjection[];
    realtimeUncertain: boolean;
    waitingForRoom: boolean;
}) {
    const { t } = useTranslation('dashboard');
    const { feedRef, searchOpen, setSearchOpen, topTooltip, hideTopTooltip, handleReturnToTop } =
        useHistorySidebarContent();

    return (
        <div className={styles.panel} onScrollCapture={hideTopTooltip}>
            <header className={styles.header}>
                <h2 id="history-heading">{t('history.title')}</h2>
            </header>
            <HistoryProvider
                mode="live"
                source={source}
                devices={devices}
                realtimeUncertain={realtimeUncertain}
                waitingForRoom={waitingForRoom}
            >
                <HistoryFeed ref={feedRef} />
                <footer className={styles.footer}>
                    <Button
                        variant="outlined"
                        type="button"
                        className={styles.filterButton}
                        aria-label={t('search', { ns: 'deviceFilters' })}
                        aria-haspopup="dialog"
                        onClick={() => setSearchOpen(true)}
                    >
                        <Search aria-hidden="true" size={18} />
                        <span>{t('search', { ns: 'deviceFilters' })}</span>
                    </Button>
                    <div className={styles.topAction}>
                        {topTooltip ? (
                            <span
                                id="history-top-tooltip"
                                role="tooltip"
                                className={styles.tooltip}
                            >
                                {t('history.alreadyAtTop')}
                            </span>
                        ) : null}
                        <Button
                            variant="outlined"
                            type="button"
                            aria-label={t('history.returnToTop')}
                            aria-describedby={topTooltip ? 'history-top-tooltip' : undefined}
                            onClick={handleReturnToTop}
                            onBlur={hideTopTooltip}
                        >
                            <ArrowUp aria-hidden="true" size={18} />
                            <span>{t('history.returnToTop')}</span>
                        </Button>
                    </div>
                </footer>
            </HistoryProvider>
            <HistorySearchModal
                open={searchOpen}
                onClose={() => setSearchOpen(false)}
                devices={devices}
            />
        </div>
    );
}
