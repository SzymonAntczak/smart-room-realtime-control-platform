import { FlaskConical, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import {
    createDeviceScenarioClient,
    type TemperatureScenarioAction,
    type TemperatureScenarioClient,
} from './temperature-scenario-client';
import styles from './TemperatureScenarioDrawer.module.css';
import { TemperatureScenarioPanel } from './TemperatureScenarioPanel';

interface TemperatureScenarioDrawerProps {
    readonly deviceId?: string;
    readonly client?: TemperatureScenarioClient;
}

export function TemperatureScenarioDrawer({
    deviceId = 'temp-desk',
    client: clientOverride,
}: TemperatureScenarioDrawerProps) {
    const reactId = useId();
    const drawerId = `device-scenario-drawer-${reactId.replace(/:/g, '')}`;
    const client = useMemo(
        () => clientOverride ?? createDeviceScenarioClient(deviceId),
        [clientOverride, deviceId],
    );
    const [isOpen, setIsOpen] = useState(false);
    const [actions, setActions] = useState<readonly TemperatureScenarioAction[]>();
    const [loadError, setLoadError] = useState<string>();
    const toggleRef = useRef<HTMLButtonElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const shouldRestoreToggleFocus = useRef(false);

    useEffect(() => {
        if (isOpen) {
            closeButtonRef.current?.focus();
        } else if (shouldRestoreToggleFocus.current) {
            toggleRef.current?.focus();
            shouldRestoreToggleFocus.current = false;
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        let isCurrent = true;
        setActions(undefined);
        setLoadError(undefined);

        const loadScenarios = client.getScenarios;
        if (!loadScenarios) {
            setLoadError(`Development scenarios are unavailable for ${deviceId}.`);
            return;
        }

        void loadScenarios()
            .then((result) => {
                if (isCurrent) setActions(result.scenarios.map((scenario) => scenario.action));
            })
            .catch(() => {
                if (isCurrent)
                    setLoadError(`Development scenarios are unavailable for ${deviceId}.`);
            });

        return () => {
            isCurrent = false;
        };
    }, [client, deviceId, isOpen]);

    function closeDrawer(): void {
        shouldRestoreToggleFocus.current = true;
        setIsOpen(false);
    }

    return (
        <>
            <button
                ref={toggleRef}
                className={styles.toggle}
                type="button"
                aria-controls={drawerId}
                aria-expanded={isOpen}
                onClick={() => (isOpen ? closeDrawer() : setIsOpen(true))}
            >
                <FlaskConical aria-hidden="true" size={16} strokeWidth={1.75} />
                <span className={styles.toggleLabel}>Dev scenarios</span>
            </button>
            {isOpen ? (
                <aside
                    id={drawerId}
                    className={styles.drawer}
                    aria-label={`Development scenarios for ${deviceId}`}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            closeDrawer();
                        }
                    }}
                >
                    <button
                        ref={closeButtonRef}
                        className={styles.close}
                        type="button"
                        onClick={closeDrawer}
                    >
                        <X aria-hidden="true" size={16} strokeWidth={1.75} />
                        Close panel
                    </button>
                    {loadError ? <p role="alert">{loadError}</p> : null}
                    {!actions && !loadError ? (
                        <p role="status">Loading development scenarios for {deviceId}…</p>
                    ) : null}
                    {actions ? (
                        <TemperatureScenarioPanel actions={actions} client={client} />
                    ) : null}
                </aside>
            ) : null}
        </>
    );
}
