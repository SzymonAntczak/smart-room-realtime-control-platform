import type {
    ActiveCommandProjection,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import type { DeviceProjection } from '@smart-room/contracts/projections';
import { Lightbulb, LightbulbOff, Power } from 'lucide-react';
import type { ReactNode } from 'react';

import { Alert, type AlertVariant } from '../../shared/ui/Alert';
import { ControlCard } from '../../shared/ui/ControlCard';

import styles from './LedControl.module.css';
import { useLedCommandRequest } from './use-led-command-request';

export function LedControl({
    device,
    activeCommand,
    recentCommand,
    headerAction,
    interactionLocked = false,
    realtimeUncertain = false,
}: {
    device: DeviceProjection;
    activeCommand?: ActiveCommandProjection;
    recentCommand?: TerminalCommandProjection;
    headerAction?: ReactNode;
    interactionLocked?: boolean;
    realtimeUncertain?: boolean;
}) {
    const { requestPower, submitting, transportError } = useLedCommandRequest(device?.deviceId);

    if (device.role !== 'led-output') {
        return null;
    }

    const isBlocked = device.commandAvailability.policy === 'block' || realtimeUncertain;
    const isBusy = submitting || interactionLocked || activeCommand !== undefined;
    const hasReportedPower = isPowerState(device.reportedState.power);
    const isOn = device.reportedState.power === 'on';
    const PowerIcon = isOn ? Lightbulb : LightbulbOff;

    return (
        <ControlCard
            title={device.name}
            titleId={`led-heading-${device.deviceId}`}
            status={formatAvailability(device.availability)}
            statusTone={
                device.availability === 'online'
                    ? 'success'
                    : device.availability === 'offline'
                      ? 'danger'
                      : 'warning'
            }
            headerAction={headerAction}
            bottomAlert={
                <Alert
                    {...getCardAlert({
                        device,
                        activeCommand,
                        recentCommand,
                        transportError,
                        realtimeUncertain,
                        submitting,
                    })}
                />
            }
        >
            <div className={styles.power} aria-label="Confirmed LED power">
                <PowerIcon aria-hidden="true" size={28} />
                <span>
                    Confirmed:{' '}
                    <strong>{hasReportedPower ? (isOn ? 'On' : 'Off') : 'Unknown'}</strong>
                </span>
            </div>
            <div className={styles.actions} aria-label="LED power controls">
                <button
                    type="button"
                    aria-label={isOn ? 'Turn off' : 'Turn on'}
                    aria-pressed={isOn}
                    className={isOn ? styles.toggleOn : styles.toggleOff}
                    disabled={isBlocked || isBusy || !hasReportedPower}
                    onClick={() => void requestPower(isOn ? 'off' : 'on')}
                >
                    <Power aria-hidden="true" size={20} />
                </button>
            </div>
        </ControlCard>
    );
}

function isPowerState(value: unknown): value is 'on' | 'off' {
    return value === 'on' || value === 'off';
}

function formatAvailability(availability: DeviceProjection['availability']) {
    return availability[0]?.toUpperCase() + availability.slice(1);
}

function terminalTimestamp(command: TerminalCommandProjection) {
    return command.status === 'confirmed'
        ? command.confirmedAt
        : command.status === 'failed'
          ? command.failedAt
          : command.timedOutAt;
}

function getCardAlert({
    device,
    activeCommand,
    recentCommand,
    transportError,
    realtimeUncertain,
    submitting,
}: {
    device: DeviceProjection;
    activeCommand?: ActiveCommandProjection;
    recentCommand?: TerminalCommandProjection;
    transportError?: string;
    realtimeUncertain: boolean;
    submitting: boolean;
}): { message?: string; variant?: AlertVariant } {
    const errors = [
        transportError,
        recentCommand?.status === 'failed' ? recentCommand.message : undefined,
        recentCommand?.status === 'timed_out'
            ? `Command timed out: ${recentCommand.reason}.`
            : undefined,
    ].filter((message): message is string => message !== undefined);
    const warnings = [
        device.availability === 'offline'
            ? `LED is offline${device.availabilityReason ? `: ${device.availabilityReason}` : '.'}`
            : undefined,
        device.health === 'degraded'
            ? (device.healthReason ?? 'LED health is degraded.')
            : undefined,
        device.observationStatus.power?.freshness === 'stale'
            ? 'LED state observation is stale.'
            : undefined,
        realtimeUncertain
            ? 'Realtime stream is reconnecting. LED controls are temporarily unavailable.'
            : undefined,
    ].filter((message): message is string => message !== undefined);
    const information = [
        submitting ? 'Submitting LED command.' : undefined,
        activeCommand
            ? `Requested: ${activeCommand.requestedState.power === 'on' ? 'On' : 'Off'} — awaiting device report.`
            : undefined,
        recentCommand?.status === 'confirmed'
            ? `Command confirmed at ${terminalTimestamp(recentCommand).slice(11, 19)} UTC.`
            : undefined,
    ].filter((message): message is string => message !== undefined);
    const messages = [...errors, ...warnings, ...information];

    if (messages.length > 0) {
        return {
            message: messages.join(' '),
            variant: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'info',
        };
    }

    if (transportError) {
        return { message: transportError, variant: 'error' };
    }

    if (recentCommand?.status === 'failed') {
        return { message: recentCommand.message, variant: 'error' };
    }

    if (recentCommand?.status === 'timed_out') {
        return { message: `Command timed out: ${recentCommand.reason}.`, variant: 'error' };
    }

    if (device.health === 'degraded') {
        return { message: device.healthReason ?? 'LED health is degraded.', variant: 'warning' };
    }

    if (device.observationStatus.power?.freshness === 'stale') {
        return { message: 'LED state observation is stale.', variant: 'warning' };
    }

    if (realtimeUncertain) {
        return {
            message: 'Realtime stream is reconnecting. LED controls are temporarily unavailable.',
            variant: 'warning',
        };
    }

    if (activeCommand) {
        return {
            message: `Requested: ${activeCommand.requestedState.power === 'on' ? 'On' : 'Off'} — awaiting device report.`,
            variant: 'info',
        };
    }

    if (recentCommand?.status === 'confirmed') {
        return {
            message: `Command confirmed at ${terminalTimestamp(recentCommand).slice(11, 19)} UTC.`,
            variant: 'info',
        };
    }

    return {};
}
