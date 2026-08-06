import type { DeviceScenarioAction } from '@smart-room/contracts/development';
import { FlaskConical, Timer, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import {
    createDeviceScenarioClient,
    type TemperatureScenarioClient,
} from '../../dev/temperature-scenarios/temperature-scenario-client';
import drawerStyles from '../../dev/temperature-scenarios/TemperatureScenarioDrawer.module.css';
import panelStyles from '../../dev/temperature-scenarios/TemperatureScenarioPanel.module.css';

const labels: Record<DeviceScenarioAction, string> = {
    pause_telemetry: 'Pause telemetry',
    resume_telemetry: 'Resume telemetry',
    replay_last_reading: 'Replay last reading',
    emit_invalid_reading: 'Emit invalid reading',
    emit_next_reading: 'Emit next reading',
    reset: 'Reset scenario',
    confirm_immediately: 'Confirm immediately',
    confirm_delayed: 'Confirm after 2 seconds',
    reject_command: 'Reject next command',
    omit_confirmation: 'Omit confirmation',
    report_after_timeout: 'Report after timeout',
};

interface LedScenarioDrawerProps {
    readonly deviceId: string;
    readonly client?: TemperatureScenarioClient;
    readonly isCommandActive?: boolean;
    readonly onRequestChange?: (isPending: boolean) => void;
    readonly selectedScenario?: DeviceScenarioAction;
    readonly onScenarioSelected?: (scenario: DeviceScenarioAction | undefined) => void;
}

export function LedScenarioDrawer({
    deviceId,
    client: clientOverride,
    isCommandActive = false,
    onRequestChange,
    selectedScenario,
    onScenarioSelected,
}: LedScenarioDrawerProps) {
    const drawerId = `led-scenario-drawer-${useId().replace(/:/g, '')}`;
    const client = useMemo(
        () => clientOverride ?? createDeviceScenarioClient(deviceId),
        [clientOverride, deviceId],
    );
    const [isOpen, setIsOpen] = useState(false);
    const [actions, setActions] = useState<readonly DeviceScenarioAction[]>();
    const [activeAction, setActiveAction] = useState<DeviceScenarioAction>();
    const [message, setMessage] = useState<string>();
    const toggleRef = useRef<HTMLButtonElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const restoreFocus = useRef(false);

    useEffect(() => {
        if (isOpen) closeRef.current?.focus();
        else if (restoreFocus.current) {
            toggleRef.current?.focus();
            restoreFocus.current = false;
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        let current = true;
        setActions(undefined);
        setMessage(undefined);
        const getScenarios = client.getScenarios;
        if (!getScenarios) {
            setMessage(`Development scenarios are unavailable for ${deviceId}.`);
            return;
        }
        void getScenarios()
            .then((result) => {
                if (current) setActions(result.scenarios.map((scenario) => scenario.action));
            })
            .catch(() => {
                if (current) setMessage(`Development scenarios are unavailable for ${deviceId}.`);
            });
        return () => {
            current = false;
        };
    }, [client, deviceId, isOpen]);

    function close(): void {
        restoreFocus.current = true;
        setIsOpen(false);
    }

    async function run(action: DeviceScenarioAction): Promise<void> {
        setActiveAction(action);
        onRequestChange?.(true);
        setMessage(undefined);
        try {
            const result = await client.runScenario(action);
            onScenarioSelected?.(
                result.action === 'confirm_immediately' ? undefined : result.action,
            );
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Scenario control request failed.');
        } finally {
            setActiveAction(undefined);
            onRequestChange?.(false);
        }
    }

    return (
        <>
            <button
                ref={toggleRef}
                className={drawerStyles.toggle}
                type="button"
                aria-controls={drawerId}
                aria-expanded={isOpen}
                disabled={isCommandActive}
                onClick={() => (isOpen ? close() : setIsOpen(true))}
            >
                <FlaskConical aria-hidden="true" size={16} strokeWidth={1.75} />
                <span className={drawerStyles.toggleLabel}>Dev scenarios</span>
            </button>
            {isOpen ? (
                <aside
                    id={drawerId}
                    className={drawerStyles.drawer}
                    aria-label={`Development scenarios for ${deviceId}`}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') close();
                    }}
                >
                    <button
                        ref={closeRef}
                        className={drawerStyles.close}
                        type="button"
                        onClick={close}
                    >
                        <X aria-hidden="true" size={16} strokeWidth={1.75} /> Close panel
                    </button>
                    {!actions && !message ? (
                        <p role="status">Loading development scenarios for {deviceId}…</p>
                    ) : null}
                    {actions ? (
                        <section className={panelStyles.panel}>
                            <p className={panelStyles.eyebrow}>Development only</p>
                            <h2>LED scenarios</h2>
                            <p className={panelStyles.description}>
                                Select how the next LED command behaves. This does not change the
                                confirmed LED state.
                            </p>
                            <div className={panelStyles.controls}>
                                {actions.map((action) => (
                                    <button
                                        key={action}
                                        className={panelStyles.button}
                                        type="button"
                                        disabled={activeAction !== undefined || isCommandActive}
                                        onClick={() => void run(action)}
                                    >
                                        <Timer aria-hidden="true" size={16} strokeWidth={1.75} />
                                        {activeAction === action ? 'Selecting...' : labels[action]}
                                    </button>
                                ))}
                            </div>
                            {message || selectedScenario ? (
                                <p className={panelStyles.message} role="status">
                                    {message ??
                                        `${labels[selectedScenario!]} selected for the next LED command.`}
                                </p>
                            ) : null}
                        </section>
                    ) : null}
                    {!actions && message ? <p role="alert">{message}</p> : null}
                </aside>
            ) : null}
        </>
    );
}
