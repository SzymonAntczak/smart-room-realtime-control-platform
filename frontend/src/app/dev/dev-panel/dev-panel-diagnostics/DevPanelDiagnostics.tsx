import type { DurableDiagnosticsSnapshot } from '@smart-room/contracts/diagnostics';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../../shared/date-time';
import { DevPanelButton } from '../dev-panel-button/DevPanelButton';

import styles from './DevPanelDiagnostics.module.css';

export function DevPanelDiagnostics({
    diagnostics,
    errorMessage,
    isActionActive,
    isRefreshing,
    onRefresh,
}: {
    diagnostics?: DurableDiagnosticsSnapshot;
    errorMessage?: string;
    isActionActive: boolean;
    isRefreshing: boolean;
    onRefresh(): void;
}) {
    const { t } = useTranslation('development');

    return (
        <section className={styles.diagnostics} aria-labelledby="scenario-diagnostics">
            <div className={styles.header}>
                <div>
                    <h3 id="scenario-diagnostics">{t('diagnostics.heading')}</h3>
                    <p>
                        {t('diagnostics.ignoredEvents', {
                            count: diagnostics?.entries.length ?? t('diagnostics.notLoaded'),
                        })}
                    </p>
                </div>
                <DevPanelButton
                    type="button"
                    disabled={isRefreshing || isActionActive}
                    onClick={onRefresh}
                >
                    <RefreshCw aria-hidden="true" size={16} strokeWidth={1.75} />
                    {isRefreshing ? t('diagnostics.refreshing') : t('diagnostics.refresh')}
                </DevPanelButton>
            </div>
            {errorMessage ? <p role="alert">{errorMessage}</p> : null}
            {diagnostics?.entries.length === 0 ? <p>{t('diagnostics.empty')}</p> : null}
            {diagnostics && diagnostics.entries.length > 0 ? (
                <ol className={styles.list}>
                    {diagnostics.entries.map((event) => (
                        <li key={`${diagnostics.historyGenerationId}:${event.internalSequence}`}>
                            <strong>{event.reason}</strong>
                            <span>{event.eventType ?? t('diagnostics.unknownEvent')}</span>
                            <span>{event.deviceId ?? t('diagnostics.noDevice')}</span>
                            <time dateTime={event.recordedAt}>
                                {formatTimestamp(event.recordedAt)}
                            </time>
                        </li>
                    ))}
                </ol>
            ) : null}
        </section>
    );
}
