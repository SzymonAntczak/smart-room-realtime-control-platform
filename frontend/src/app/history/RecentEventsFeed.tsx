import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { RenderableDeviceProjection } from '../shared/room-rendering';

import styles from './RecentEventsFeed.module.css';
import { useUserHistoryVirtualizer } from './use-user-history-virtualizer';
import type { UserHistoryReadingPosition, UserHistorySessionState } from './user-history-session';
import { UserHistoryItemRow } from './UserHistoryItemRow';

export function RecentEventsFeed({
    state,
    devices,
    realtimeUncertain,
    scrollRoot,
    header,
    updateReadingPosition,
    loadOlder,
}: {
    state: UserHistorySessionState;
    devices: readonly RenderableDeviceProjection[];
    realtimeUncertain: boolean;
    scrollRoot: RefObject<HTMLElement | null>;
    header: RefObject<HTMLDivElement | null>;
    updateReadingPosition(position: UserHistoryReadingPosition | null): void;
    loadOlder(): void;
}) {
    const { t } = useTranslation('dashboard');
    const history = useUserHistoryVirtualizer({
        state,
        scrollRoot,
        header,
        updateReadingPosition,
        loadOlder,
    });

    return (
        <section className={styles.feed} aria-labelledby="recent-events-heading">
            <h2 id="recent-events-heading">{t('feed.heading')}</h2>
            {realtimeUncertain ? <p className={styles.notice}>{t('feed.lastKnown')}</p> : null}
            {state.items.length === 0 ? <p className={styles.empty}>{t('feed.empty')}</p> : null}
            <ol
                className={styles.list}
                ref={history.listRef}
                style={{ blockSize: history.totalSize }}
            >
                {history.rows.map((row) => {
                    const item = state.items[row.index];

                    return item ? (
                        <UserHistoryItemRow
                            key={item.recordId}
                            item={item}
                            devices={devices}
                            index={row.index}
                            setSize={state.endReached ? state.items.length : -1}
                            ref={history.measureElement}
                            style={{
                                position: 'absolute',
                                insetBlockStart: 0,
                                inlineSize: '100%',
                                transform: `translateY(${row.start - history.scrollMargin}px)`,
                            }}
                        />
                    ) : null;
                })}
            </ol>
        </section>
    );
}
