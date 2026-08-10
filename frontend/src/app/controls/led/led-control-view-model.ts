import type {
    ActiveCommandProjection,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import type { DeviceProjection } from '@smart-room/contracts/projections';

import type { AlertVariant } from '../../shared/ui/Alert';

export type LedControlViewModel = {
    availabilityLabel: string;
    availabilityTone: 'success' | 'danger' | 'warning';
    hasReportedPower: boolean;
    isOn: boolean;
    isInteractionDisabled: boolean;
    alert: { message?: string; variant?: AlertVariant };
};

export function toLedControlViewModel({
    device,
    activeCommand,
    recentCommand,
    transportError,
    realtimeUncertain,
    submitting,
    interactionLocked,
}: {
    device: DeviceProjection;
    activeCommand?: ActiveCommandProjection;
    recentCommand?: TerminalCommandProjection;
    transportError?: string;
    realtimeUncertain: boolean;
    submitting: boolean;
    interactionLocked: boolean;
}): LedControlViewModel {
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
    const hasReportedPower = isPowerState(device.reportedState.power);

    return {
        availabilityLabel: formatAvailability(device.availability),
        availabilityTone:
            device.availability === 'online'
                ? 'success'
                : device.availability === 'offline'
                  ? 'danger'
                  : 'warning',
        hasReportedPower,
        isOn: device.reportedState.power === 'on',
        isInteractionDisabled:
            device.commandAvailability.policy === 'block' ||
            realtimeUncertain ||
            submitting ||
            interactionLocked ||
            activeCommand !== undefined ||
            !hasReportedPower,
        alert:
            messages.length > 0
                ? {
                      message: messages.join(' '),
                      variant:
                          errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'info',
                  }
                : {},
    };
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
