import type { LiveTelemetrySampleProjection } from '@smart-room/contracts/history';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../../features/date-time';

import styles from './TelemetryTable.module.css';

export function TelemetryTable({
    samples,
    emptyMessage,
}: {
    samples: readonly LiveTelemetrySampleProjection[];
    emptyMessage: string;
}) {
    const { t } = useTranslation('deviceDetails');

    return (
        <div className={styles.scroll}>
            <table className={styles.table}>
                <caption>{t('table.caption')}</caption>
                <thead>
                    <tr>
                        <th scope="col">{t('table.time')}</th>
                        <th scope="col">{t('table.value')}</th>
                        <th scope="col">{t('table.unit')}</th>
                        <th scope="col">{t('table.durability')}</th>
                    </tr>
                </thead>
                <tbody>
                    {samples.length > 0 ? (
                        samples.map((sample) => (
                            <tr key={sample.recordId}>
                                <td>{formatTimestamp(sample.occurredAt)}</td>
                                <td>{String(sample.value)}</td>
                                <td>{t('temperatureUnit')}</td>
                                <td>{t(`telemetry.durability.${sample.durability}`)}</td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={4}>{emptyMessage}</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
