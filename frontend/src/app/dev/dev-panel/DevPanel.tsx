import type {
    DeviceScenarioAction,
    EventProcessingDiagnosticsSnapshot,
} from '@smart-room/contracts/development';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import {
    CircleAlert,
    FlaskConical,
    History,
    Pause,
    Play,
    RefreshCw,
    RotateCcw,
    StepForward,
    Timer,
    Wifi,
    X,
} from 'lucide-react';
import type { ReactNode } from 'react';

import styles from './DevPanel.module.css';
import type {
    ScenarioActionDefinition,
    ScenarioDefinition,
    ScenarioIcon,
} from './scenario-definition';
import { useDevPanel } from './use-dev-panel';
import { useScenarioActionRequest } from './use-scenario-action-request';

const iconByName: Record<ScenarioIcon, typeof Timer> = {
    alert: CircleAlert,
    history: History,
    pause: Pause,
    play: Play,
    refresh: RotateCcw,
    'step-forward': StepForward,
    timer: Timer,
    wifi: Wifi,
};

export interface DevPanelTarget {
    readonly definition: ScenarioDefinition;
    readonly deviceId: string;
}

function DevPanelRoot({ children }: { children: ReactNode }) {
    return children;
}

function DevPanelTrigger({
    deviceId,
    expanded,
    onClick,
}: {
    deviceId: string;
    expanded: boolean;
    onClick(): void;
}) {
    return (
        <button
            id={`dev-scenarios-${deviceId}`}
            className={styles.trigger}
            type="button"
            aria-controls="dev-panel"
            aria-expanded={expanded}
            onClick={onClick}
        >
            <FlaskConical aria-hidden="true" size={16} strokeWidth={1.75} />
            <span className={styles.triggerLabel}>Dev scenarios</span>
        </button>
    );
}

function DevPanelSidebar({
    target,
    snapshot,
    onClose,
    onRequestChange,
}: {
    target: DevPanelTarget;
    snapshot: RoomSnapshotProjection;
    onClose(): void;
    onRequestChange(deviceId: string, isPending: boolean): void;
}) {
    const { actions, client, closeButtonRef, loadError } = useDevPanel(target.deviceId);
    const device = snapshot.devices.find((candidate) => candidate.deviceId === target.deviceId);
    const isCommandActive = snapshot.activeCommands.some(
        (command) => command.deviceId === target.deviceId,
    );
    const request = useScenarioActionRequest({
        client,
        definition: target.definition,
        isCommandActive,
        onRequestChange: (isPending) => onRequestChange(target.deviceId, isPending),
    });

    if (!client) {
        return null;
    }

    return (
        <aside
            id="dev-panel"
            className={styles.drawer}
            aria-label={`Development scenarios for ${target.deviceId}`}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    onClose();
                }
            }}
        >
            <button ref={closeButtonRef} className={styles.close} type="button" onClick={onClose}>
                <X aria-hidden="true" size={16} strokeWidth={1.75} />
                Close panel
            </button>
            {loadError ? <p role="alert">{loadError}</p> : null}
            {!actions && !loadError ? (
                <p role="status">Loading development scenarios for {target.deviceId}…</p>
            ) : null}
            {actions ? (
                <DevPanelContent
                    activeAction={request.activeAction}
                    availableActions={actions}
                    definition={target.definition}
                    isCommandActive={isCommandActive}
                    isOffline={device?.availability === 'offline'}
                    message={request.message}
                    onRunScenario={(action) => void request.runScenario(action)}
                />
            ) : null}
            {actions && target.definition.diagnostics ? (
                <DevPanelDiagnostics
                    diagnostics={request.diagnostics}
                    errorMessage={request.diagnosticsErrorMessage}
                    isActionActive={request.activeAction !== undefined}
                    isRefreshing={request.isRefreshingDiagnostics}
                    onRefresh={() => void request.refreshDiagnostics()}
                />
            ) : null}
        </aside>
    );
}

function DevPanelContent({
    activeAction,
    availableActions,
    definition,
    isCommandActive,
    isOffline,
    message,
    onRunScenario,
}: {
    activeAction?: DeviceScenarioAction;
    availableActions: readonly DeviceScenarioAction[];
    definition: ScenarioDefinition;
    isCommandActive: boolean;
    isOffline: boolean;
    message?: string;
    onRunScenario(action: DeviceScenarioAction): void;
}) {
    return (
        <section className={styles.panel}>
            <p className={styles.eyebrow}>Development only</p>
            <h2>{definition.title}</h2>
            <p className={styles.description}>{definition.description}</p>
            {isOffline && hasOfflineBlockedAction(definition) ? (
                <p>Telemetry controls are unavailable while the device is offline.</p>
            ) : null}
            <div>
                {definition.sections.map((section) => {
                    const actions = section.actions.filter((action) =>
                        availableActions.includes(action.action),
                    );

                    if (actions.length === 0) {
                        return null;
                    }

                    return (
                        <section key={section.title} className={styles.section}>
                            <h3>{section.title}</h3>
                            <div className={styles.actions}>
                                {actions.map((action) => (
                                    <DevPanelAction
                                        key={action.action}
                                        action={action}
                                        disabled={
                                            activeAction !== undefined ||
                                            isBlocked(action, isOffline, isCommandActive)
                                        }
                                        isActive={activeAction === action.action}
                                        onClick={() => onRunScenario(action.action)}
                                    />
                                ))}
                            </div>
                        </section>
                    );
                })}
            </div>
            {message ? (
                <p className={styles.status} role="status">
                    {message}
                </p>
            ) : null}
        </section>
    );
}

function DevPanelAction({
    action,
    disabled,
    isActive,
    onClick,
}: {
    action: ScenarioActionDefinition;
    disabled: boolean;
    isActive: boolean;
    onClick(): void;
}) {
    const Icon = iconByName[action.icon];

    return (
        <button
            className={`${styles.action} ${isActive ? styles.actionActive : ''}`}
            type="button"
            aria-busy={isActive || undefined}
            disabled={disabled}
            onClick={onClick}
        >
            <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
            {action.label}
        </button>
    );
}

function DevPanelDiagnostics({
    diagnostics,
    errorMessage,
    isActionActive,
    isRefreshing,
    onRefresh,
}: {
    diagnostics?: EventProcessingDiagnosticsSnapshot;
    errorMessage?: string;
    isActionActive: boolean;
    isRefreshing: boolean;
    onRefresh(): void;
}) {
    return (
        <section className={styles.diagnostics} aria-labelledby="scenario-diagnostics">
            <div className={styles.diagnosticsHeader}>
                <div>
                    <h3 id="scenario-diagnostics">Diagnostics</h3>
                    <p>Ignored events: {diagnostics?.ignoredEvents.length ?? 'not loaded'}</p>
                </div>
                <button
                    className={styles.action}
                    type="button"
                    disabled={isRefreshing || isActionActive}
                    onClick={onRefresh}
                >
                    <RefreshCw aria-hidden="true" size={16} strokeWidth={1.75} />
                    {isRefreshing ? 'Refreshing...' : 'Refresh diagnostics'}
                </button>
            </div>
            {errorMessage ? <p role="alert">{errorMessage}</p> : null}
            {diagnostics?.ignoredEvents.length === 0 ? <p>No ignored events recorded.</p> : null}
            {diagnostics && diagnostics.ignoredEvents.length > 0 ? (
                <ol className={styles.diagnosticsList}>
                    {diagnostics.ignoredEvents.map((event) => (
                        <li key={event.diagnosticId}>
                            <strong>{event.reason}</strong>
                            <span>{event.eventType ?? 'unknown event'}</span>
                            <span>{event.deviceId ?? 'no device'}</span>
                            <time dateTime={event.observedAt}>{formatTime(event.observedAt)}</time>
                        </li>
                    ))}
                </ol>
            ) : null}
        </section>
    );
}

export const DevPanel = Object.assign(DevPanelRoot, {
    Content: DevPanelContent,
    Sidebar: DevPanelSidebar,
    Trigger: DevPanelTrigger,
});

function hasOfflineBlockedAction(definition: ScenarioDefinition): boolean {
    return definition.sections.some((section) =>
        section.actions.some((action) => action.blockedWhen?.includes('offline')),
    );
}

function isBlocked(
    action: ScenarioActionDefinition,
    isOffline: boolean,
    isCommandActive: boolean,
): boolean {
    return Boolean(
        (isOffline && action.blockedWhen?.includes('offline')) ||
        (isCommandActive && action.blockedWhen?.includes('active-command')),
    );
}

function formatTime(timestamp: string): string {
    return `${timestamp.slice(11, 19)} UTC`;
}
