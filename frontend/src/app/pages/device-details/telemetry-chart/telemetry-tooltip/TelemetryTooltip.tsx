import type { LiveTelemetrySampleProjection } from '@smart-room/contracts/history';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../../../features/date-time';

import styles from './TelemetryTooltip.module.css';

export function TelemetryTooltip({
    samples,
}: {
    samples: readonly LiveTelemetrySampleProjection[];
}) {
    const { t } = useTranslation('deviceDetails');
    const first = samples[0];

    if (!first) {
        return null;
    }

    return (
        <div
            className={styles.tooltip}
            role="tooltip"
            tabIndex={-1}
            aria-label={t('chart.measurements')}
            aria-live="polite"
            aria-atomic="true"
        >
            <p className={styles.time}>{formatTimestamp(first.occurredAt)}</p>
            <ul className={styles.samples}>
                {samples.map((sample) => (
                    <li key={sample.recordId}>
                        {String(sample.value)} {t('temperatureUnit')} —{' '}
                        {t(`telemetry.durability.${sample.durability}`)}
                    </li>
                ))}
            </ul>
        </div>
    );
}
