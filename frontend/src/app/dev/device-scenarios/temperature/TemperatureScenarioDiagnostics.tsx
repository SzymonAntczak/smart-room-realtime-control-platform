import type { EventProcessingDiagnosticsSnapshot } from '@smart-room/contracts/development';
import { RefreshCw } from 'lucide-react';

import { ScenarioPanelAction } from '../scenario-panel';

import styles from './TemperatureScenarioDiagnostics.module.css';

interface TemperatureScenarioDiagnosticsProps {
    readonly diagnostics?: EventProcessingDiagnosticsSnapshot;
    readonly errorMessage?: string;
    readonly isRefreshing: boolean;
    readonly isActionActive: boolean;
    onRefresh(): void;
}

export function TemperatureScenarioDiagnostics({
    diagnostics,
    errorMessage,
    isRefreshing,
    isActionActive,
    onRefresh,
}: TemperatureScenarioDiagnosticsProps) {
    return (
        <section className={styles.diagnostics} aria-labelledby="temperature-scenario-diagnostics">
            <div className={styles.header}>
                <div>
                    <h3 id="temperature-scenario-diagnostics">Diagnostics</h3>
                    <p>Ignored events: {diagnostics?.ignoredEvents.length ?? 'not loaded'}</p>
                </div>
                <ScenarioPanelAction
                    type="button"
                    disabled={isRefreshing || isActionActive}
                    onClick={onRefresh}
                >
                    <RefreshCw aria-hidden="true" size={16} strokeWidth={1.75} />
                    {isRefreshing ? 'Refreshing...' : 'Refresh diagnostics'}
                </ScenarioPanelAction>
            </div>
            {errorMessage ? <p role="alert">{errorMessage}</p> : null}
            {diagnostics?.ignoredEvents.length === 0 ? <p>No ignored events recorded.</p> : null}
            {diagnostics && diagnostics.ignoredEvents.length > 0 ? (
                <ol className={styles.list}>
                    {diagnostics.ignoredEvents.map((event) => (
                        <li key={event.diagnosticId}>
                            <strong>{event.reason}</strong>
                            <span>{event.eventType ?? 'unknown event'}</span>
                            <span>{event.deviceId ?? 'no device'}</span>
                            <time dateTime={event.observedAt}>
                                {formatDiagnosticTime(event.observedAt)}
                            </time>
                        </li>
                    ))}
                </ol>
            ) : null}
        </section>
    );
}

function formatDiagnosticTime(timestamp: string): string {
    return `${timestamp.slice(11, 19)} UTC`;
}
