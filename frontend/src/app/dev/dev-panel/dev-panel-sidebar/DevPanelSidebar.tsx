import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DevPanelButton } from '../dev-panel-button/DevPanelButton';
import { DevPanelContent } from '../dev-panel-content/DevPanelContent';
import { DevPanelDiagnostics } from '../dev-panel-diagnostics/DevPanelDiagnostics';
import type { DevPanelTarget } from '../types';
import { useDevPanel } from '../useDevPanel';
import { useScenarioActionRequest } from '../useScenarioActionRequest';

import styles from './DevPanelSidebar.module.css';

export function DevPanelSidebar({
    target,
    snapshot,
    onClose,
    onRequestChange,
}: {
    target: DevPanelTarget;
    snapshot: Pick<RoomSnapshotProjection, 'devices' | 'activeCommands' | 'recentCommands'>;
    onClose(): void;
    onRequestChange(deviceId: string, isPending: boolean): void;
}) {
    const { t } = useTranslation('development');
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
            aria-label={t('panelAriaLabel', { deviceId: target.deviceId })}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    onClose();
                }
            }}
        >
            <DevPanelButton
                ref={closeButtonRef}
                className={styles.close}
                variant="close"
                type="button"
                onClick={onClose}
            >
                <X aria-hidden="true" size={16} strokeWidth={1.75} />
                {t('closePanel')}
            </DevPanelButton>
            {loadError ? <p role="alert">{loadError}</p> : null}
            {!actions && !loadError ? (
                <p role="status">{t('loading', { deviceId: target.deviceId })}</p>
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
