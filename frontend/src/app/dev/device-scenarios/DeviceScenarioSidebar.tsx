import { X } from 'lucide-react';

import type { DeviceScenarioTarget } from './device-scenario-target';
import styles from './DeviceScenarioSidebar.module.css';
import { LedScenarioPanel } from './led/LedScenarioPanel';
import { TemperatureScenarioPanel } from './temperature/TemperatureScenarioPanel';
import { useDeviceScenarioSidebar } from './use-device-scenario-sidebar';

export function DeviceScenarioSidebar({
    target,
    onClose,
    onLedScenarioRequestChange,
}: {
    target?: DeviceScenarioTarget;
    onClose(): void;
    onLedScenarioRequestChange(deviceId: string, isPending: boolean): void;
}) {
    const { actions, client, closeButtonRef, loadError } = useDeviceScenarioSidebar(target);

    if (!target || !client) return null;

    return (
        <aside
            id="device-scenario-sidebar"
            className={styles.drawer}
            aria-label={`Development scenarios for ${target.deviceId}`}
            onKeyDown={(event) => {
                if (event.key === 'Escape') onClose();
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
            {actions && target.kind === 'temperature' ? (
                <TemperatureScenarioPanel
                    client={client}
                    actions={actions}
                    telemetryUnavailable={target.telemetryUnavailable}
                />
            ) : null}
            {actions && target.kind === 'led' ? (
                <LedScenarioPanel
                    client={client}
                    actions={actions}
                    isCommandActive={target.isCommandActive}
                    onRequestChange={(isPending) =>
                        onLedScenarioRequestChange(target.deviceId, isPending)
                    }
                />
            ) : null}
        </aside>
    );
}
