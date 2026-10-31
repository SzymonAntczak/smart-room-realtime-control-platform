import type { LiveTelemetrySampleProjection } from '@smart-room/contracts/history';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../../../shared/date-time';
import { StatusTag } from '../../../../shared/ui';

import styles from './TelemetryItem.module.css';

export function TelemetryItem({ item }: { item: LiveTelemetrySampleProjection }) {
    const { t } = useTranslation('deviceDetails');

    return (
        <article className={styles.entry}>
            <div className={styles.reading}>
                <strong>
                    {String(item.value)} {t('temperatureUnit')}
                </strong>
                {item.durability === 'volatile' ? (
                    <StatusTag tone="warning">{t('telemetry.durability.volatile')}</StatusTag>
                ) : null}
            </div>
            <time dateTime={item.occurredAt}>{formatTimestamp(item.occurredAt)}</time>
        </article>
    );
}
