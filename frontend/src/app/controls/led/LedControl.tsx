import type {
    ActiveCommandProjection,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import type { DeviceProjection } from '@smart-room/contracts/projections';
import { Lightbulb, LightbulbOff, Power, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { ControlCard } from '../../shared/ui/ControlCard';

import { submitLedPowerCommand } from './led-command-client';
import styles from './LedControl.module.css';
import { LedScenarioDrawer } from './LedScenarioDrawer';

export function LedControl({
    device,
    activeCommand,
    recentCommand,
    showDevScenarioPanel = false,
    realtimeUncertain = false,
}: {
    device?: DeviceProjection;
    activeCommand?: ActiveCommandProjection;
    recentCommand?: TerminalCommandProjection;
    showDevScenarioPanel?: boolean;
    realtimeUncertain?: boolean;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [selectingScenario, setSelectingScenario] = useState(false);
    const [transportError, setTransportError] = useState<string>();

    if (!device) {
        return (
            <ControlCard eyebrow="Realtime room stream" title="Main LED" status="Unavailable">
                <p className={styles.message}>No LED device is available yet.</p>
            </ControlCard>
        );
    }

    const isLed = device.role === 'led-output' && isPowerState(device.reportedState.power);
    if (!isLed) return null;

    const isBlocked = device.commandAvailability.policy === 'block' || realtimeUncertain;
    const isBusy = submitting || selectingScenario || activeCommand !== undefined;
    const deviceId = device.deviceId;
    const confirmedPower = device.reportedState.power;
    const isOn = confirmedPower === 'on';
    const PowerIcon = isOn ? Lightbulb : LightbulbOff;
    const requestedPower = activeCommand?.requestedState.power;
    const status = submitting
        ? 'Submitting'
        : activeCommand === undefined
          ? formatHealth(device.health)
          : activeCommand.status === 'accepted'
            ? 'Accepted'
            : 'Pending';

    async function requestPower(power: 'on' | 'off'): Promise<void> {
        setSubmitting(true);
        setTransportError(undefined);
        try {
            const result = await submitLedPowerCommand({
                deviceId,
                commandType: 'set.power',
                requestedState: { power },
            });
            if (result.status === 'rejected') setTransportError(result.message);
        } catch {
            setTransportError('Unable to send the LED command. Please try again.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <ControlCard
            eyebrow="Realtime room stream"
            title={device.name}
            titleId={`led-heading-${device.deviceId}`}
            headerAction={
                showDevScenarioPanel ? (
                    <LedScenarioDrawer
                        deviceId={device.deviceId}
                        isCommandActive={activeCommand !== undefined}
                        onRequestChange={setSelectingScenario}
                    />
                ) : undefined
            }
            status={status}
            statusTone={
                isBlocked || device.health === 'offline'
                    ? 'danger'
                    : activeCommand || submitting
                      ? 'warning'
                      : device.health === 'online'
                        ? 'success'
                        : 'warning'
            }
        >
            {device.commandAvailability.policy === 'allow_with_warning' ||
            device.health === 'stale' ? (
                <p className={styles.warning} role="alert">
                    <TriangleAlert aria-hidden="true" size={16} /> LED state may be stale. Commands
                    remain available.
                </p>
            ) : null}
            {isBlocked ? (
                <p className={styles.warning} role="alert">
                    {realtimeUncertain
                        ? 'Realtime stream is reconnecting. LED controls are temporarily unavailable.'
                        : (device.warning ?? 'LED controls are unavailable.')}
                </p>
            ) : null}
            {transportError ? (
                <p className={styles.error} role="alert">
                    {transportError}
                </p>
            ) : null}
            <div className={styles.power} aria-label="Confirmed LED power">
                <PowerIcon aria-hidden="true" size={28} />
                <span>
                    Confirmed: <strong>{isOn ? 'On' : 'Off'}</strong>
                </span>
            </div>
            <div className={styles.actions} aria-label="LED power controls">
                <button
                    type="button"
                    aria-label={isOn ? 'Turn off' : 'Turn on'}
                    aria-pressed={isOn}
                    className={isOn ? styles.toggleOn : styles.toggleOff}
                    disabled={isBlocked || isBusy}
                    onClick={() => void requestPower(isOn ? 'off' : 'on')}
                >
                    <Power aria-hidden="true" size={20} />
                </button>
            </div>
            <div className={styles.commandMessages}>
                {recentCommand ? (
                    <p
                        className={
                            recentCommand.status === 'confirmed' ? styles.message : styles.error
                        }
                        role="status"
                    >
                        Latest command: {recentCommand.status.replace('_', ' ')} at{' '}
                        <time dateTime={terminalTimestamp(recentCommand)}>
                            {terminalTimestamp(recentCommand).slice(11, 19)} UTC
                        </time>
                        {' — '}
                        {recentCommand.status === 'failed'
                            ? recentCommand.message
                            : (recentCommand.reason ?? 'completed')}
                    </p>
                ) : null}
                <p className={styles.requested} aria-hidden={requestedPower === undefined}>
                    {requestedPower
                        ? `Requested: ${requestedPower === 'on' ? 'On' : 'Off'} — awaiting device report.`
                        : null}
                </p>
            </div>
        </ControlCard>
    );
}

function isPowerState(value: unknown): value is 'on' | 'off' {
    return value === 'on' || value === 'off';
}

function formatHealth(health: DeviceProjection['health']): string {
    return health[0]?.toUpperCase() + health.slice(1);
}

function terminalTimestamp(command: TerminalCommandProjection): string {
    if (command.status === 'confirmed') return command.confirmedAt;
    if (command.status === 'failed') return command.failedAt;
    return command.timedOutAt;
}
