import type { RawTelemetrySampleProjection } from '@smart-room/contracts/history';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../../../features/date-time';

import styles from './TelemetryItem.module.css';

export function TelemetryItem({ item }: { item: RawTelemetrySampleProjection }) {
    const { t } = useTranslation('deviceDetails');

    return (
        <article className={styles.entry}>
            <strong>
                {String(item.value)} {t('temperatureUnit')}
            </strong>
            <time dateTime={item.occurredAt}>{formatTimestamp(item.occurredAt)}</time>
            <span>{t(`telemetry.durability.${item.durability}`)}</span>
        </article>
    );
}
