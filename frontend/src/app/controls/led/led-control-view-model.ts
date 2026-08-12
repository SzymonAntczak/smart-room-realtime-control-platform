import type {
    ActiveCommandProjection,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';

import type { LedDeviceProjection } from '../../shared/room-rendering';
import type { AlertVariant } from '../../shared/ui/Alert';

export type LedAlert =
    | { readonly kind: 'raw'; readonly message: string }
    | { readonly kind: 'command-timed-out'; readonly reason: string }
    | { readonly kind: 'offline'; readonly reason?: string }
    | { readonly kind: 'degraded'; readonly reason?: string }
    | { readonly kind: 'stale' }
    | { readonly kind: 'realtime-reconnecting' }
    | { readonly kind: 'submitting' }
    | { readonly kind: 'requested'; readonly power: 'on' | 'off' }
    | { readonly kind: 'command-confirmed'; readonly time: string };

export type LedControlViewModel = {
    availability: LedDeviceProjection['availability'];
    availabilityTone: 'success' | 'danger' | 'warning';
    hasReportedPower: boolean;
    isOn: boolean;
    isInteractionDisabled: boolean;
    alert: { messages: readonly LedAlert[]; variant?: AlertVariant };
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
    device: LedDeviceProjection;
    activeCommand?: ActiveCommandProjection;
    recentCommand?: TerminalCommandProjection;
    transportError?: string;
    realtimeUncertain: boolean;
    submitting: boolean;
    interactionLocked: boolean;
}): LedControlViewModel {
    const errors: LedAlert[] = [
        ...(transportError ? [{ kind: 'raw' as const, message: transportError }] : []),
        ...(recentCommand?.status === 'failed'
            ? [{ kind: 'raw' as const, message: recentCommand.message }]
            : []),
        ...(recentCommand?.status === 'timed_out'
            ? [{ kind: 'command-timed-out' as const, reason: recentCommand.reason }]
            : []),
    ];
    const warnings: LedAlert[] = [
        ...(device.availability === 'offline'
            ? [{ kind: 'offline' as const, reason: device.availabilityReason }]
            : []),
        ...(device.health === 'degraded'
            ? [{ kind: 'degraded' as const, reason: device.healthReason }]
            : []),
        ...(device.observationStatus.power?.freshness === 'stale'
            ? [{ kind: 'stale' as const }]
            : []),
        ...(realtimeUncertain ? [{ kind: 'realtime-reconnecting' as const }] : []),
    ];
    const information: LedAlert[] = [
        ...(submitting ? [{ kind: 'submitting' as const }] : []),
        ...(activeCommand
            ? [{ kind: 'requested' as const, power: activeCommand.requestedState.power }]
            : []),
        ...(recentCommand?.status === 'confirmed'
            ? [
                  {
                      kind: 'command-confirmed' as const,
                      time: terminalTimestamp(recentCommand),
                  },
              ]
            : []),
    ];
    const messages = [...errors, ...warnings, ...information];
    const hasReportedPower = device.reportedState.power !== undefined;

    return {
        availability: device.availability,
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
        alert: {
            messages,
            ...(messages.length > 0
                ? {
                      variant:
                          errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'info',
                  }
                : {}),
        },
    };
}

function terminalTimestamp(command: TerminalCommandProjection) {
    return command.status === 'confirmed'
        ? command.confirmedAt
        : command.status === 'failed'
          ? command.failedAt
          : command.timedOutAt;
}
