import type { RawTelemetrySampleProjection } from '@smart-room/contracts/history';
import { useTranslation } from 'react-i18next';

import { TelemetryChart } from '../telemetry-chart/TelemetryChart';
import { TelemetryTable } from '../telemetry-table/TelemetryTable';

import styles from './TelemetryPanel.module.css';

export function TelemetryPanel({ samples }: { samples: readonly RawTelemetrySampleProjection[] }) {
    const { t } = useTranslation('deviceDetails');

    return (
        <section className={styles.panel} aria-labelledby="telemetry-heading">
            <h2 id="telemetry-heading">{t('telemetryTitle')}</h2>
            <p>{t('historyUnavailable')}</p>
            <TelemetryChart samples={samples} />
            <TelemetryTable samples={samples} />
        </section>
    );
}
