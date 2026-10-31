import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../../shared/date-time';
import { DeviceFilters, DeviceFiltersProvider } from '../../../shared/device-filters';
import { InfiniteList, type InfiniteListHandle } from '../../../shared/infinite-scrolling';
import { Button } from '../../../shared/ui';

import { TelemetryItem } from './telemetry-item/TelemetryItem';
import { useTelemetryList } from './useTelemetryList';

export function TelemetryList({ device }: { device: { deviceId: string; name: string } }) {
    const { t } = useTranslation('deviceDetails');
    const { state, search, refresh, clear, retry, loadMore, validate } = useTelemetryList(
        device.deviceId,
    );
    const list = useRef<InfiniteListHandle | null>(null);
    useLayoutEffect(() => {
        list.current?.scrollToTop();
    }, [state.sessionRevision]);
    const visibleItems = state.lastKnown || state.status === 'error' ? [] : state.items;

    return (
        <section aria-labelledby="telemetry-list-heading">
            <h3 id="telemetry-list-heading">{t('telemetryList.title')}</h3>
            <p>{t('telemetryList.static')}</p>
            <DeviceFiltersProvider
                devices={[device]}
                fixedDeviceId={device.deviceId}
                onApply={search}
                onRefresh={() => {
                    void refresh();
                }}
                onClear={clear}
                validate={validate}
            >
                <DeviceFilters />
            </DeviceFiltersProvider>
            {state.metadata && !state.lastKnown ? (
                <p>
                    {t('telemetry.range', {
                        from: formatTimestamp(state.metadata.range.from),
                        to: formatTimestamp(state.metadata.range.to),
                    })}
                </p>
            ) : null}
            <p>{t('telemetry.count', { count: visibleItems.length })}</p>
            <InfiniteList
                ref={list}
                items={visibleItems}
                getItemKey={(item) => item.recordId}
                getItemTestId={(item) => `telemetry-item-${item.recordId}`}
                renderItem={(item) => <TelemetryItem item={item} />}
                defaultItemHeight={96}
                ariaLabel={t('telemetryList.scrollRegion')}
                hasMore={
                    state.status === 'ready' && state.nextCursor !== null && !state.limitReached
                }
                loading={state.status === 'loading'}
                endReached={state.endReached}
                onLoadMore={loadMore}
                afterItems={
                    <>
                        {state.status === 'idle' || state.status === 'loading' ? (
                            <p role="status">{t('telemetry.loading')}</p>
                        ) : null}
                        {state.status === 'ready' && !state.items.length ? (
                            <p role="status">{t('telemetry.empty')}</p>
                        ) : null}
                        {state.status === 'ready' && state.endReached && state.items.length > 0 ? (
                            <p role="status">{t('telemetryList.end')}</p>
                        ) : null}
                        {state.limitReached ? (
                            <p role="status">{t('telemetryList.limit')}</p>
                        ) : null}
                        {state.status === 'error' ? (
                            <div role="alert">
                                <p>{t(`telemetryList.errors.${state.error}`)}</p>
                                <Button
                                    variant="outlined"
                                    onClick={() => {
                                        if (state.refreshRequired) {
                                            void refresh();
                                        } else {
                                            void retry();
                                        }
                                    }}
                                >
                                    {state.refreshRequired
                                        ? t('telemetryList.refresh')
                                        : t('telemetry.retry')}
                                </Button>
                            </div>
                        ) : null}
                    </>
                }
            />
        </section>
    );
}
