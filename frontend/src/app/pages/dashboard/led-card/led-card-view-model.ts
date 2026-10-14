import type {
    AcceptedCommandResponse,
    ActiveCommandProjection,
    RejectedCommandResponse,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';

import type { AlertVariant } from '../../../ui';

import type { LedDeviceProjection } from './LedCard';

export type LedCardAlert =
    | { readonly kind: 'raw'; readonly message: string }
    | { readonly kind: 'command-timed-out'; readonly reason: string }
    | { readonly kind: 'offline'; readonly reason?: string }
    | { readonly kind: 'degraded'; readonly reason?: string }
    | { readonly kind: 'stale' }
    | { readonly kind: 'realtime-reconnecting' }
    | { readonly kind: 'submitting' }
    | { readonly kind: 'requested'; readonly power: 'on' | 'off' }
    | { readonly kind: 'command-confirmed'; readonly time: string };

export type LedCommandEvidence =
    | { context: 'admission'; command: AcceptedCommandResponse | RejectedCommandResponse }
    | {
          context: 'active' | 'recent' | 'correlated';
          command: ActiveCommandProjection | TerminalCommandProjection;
      };

type LedCardViewModel = {
    availability: LedDeviceProjection['availability'];
    availabilityTone: 'success' | 'danger' | 'warning';
    hasReportedPower: boolean;
    isOn: boolean;
    isInteractionDisabled: boolean;
    alert: { messages: readonly LedCardAlert[]; variant?: AlertVariant };
    deviceEvidence: {
        label: 'availability' | 'health' | 'power';
        durability: LedDeviceProjection['availabilityDurability'];
    }[];
    commandEvidence: LedCommandEvidence[];
};

export function toLedCardViewModel({
    device,
    activeCommand,
    recentCommand,
    transportError,
    admissionEvidence,
    correlatedCommand,
    realtimeUncertain,
    submitting,
    interactionLocked,
}: {
    device: LedDeviceProjection;
    activeCommand?: ActiveCommandProjection;
    recentCommand?: TerminalCommandProjection;
    transportError?: string;
    admissionEvidence?: AcceptedCommandResponse | RejectedCommandResponse;
    correlatedCommand?: ActiveCommandProjection | TerminalCommandProjection;
    realtimeUncertain: boolean;
    submitting: boolean;
    interactionLocked: boolean;
}): LedCardViewModel {
    const additionalCommand =
        correlatedCommand &&
        correlatedCommand.commandId !== activeCommand?.commandId &&
        correlatedCommand.commandId !== recentCommand?.commandId
            ? correlatedCommand
            : undefined;
    const terminalCommands = [recentCommand, additionalCommand].filter(
        (command): command is TerminalCommandProjection =>
            command !== undefined && command.status !== 'accepted' && command.status !== 'pending',
    );
    const errors: LedCardAlert[] = [
        ...(transportError ? [{ kind: 'raw' as const, message: transportError }] : []),
        ...(admissionEvidence?.status === 'rejected'
            ? [{ kind: 'raw' as const, message: admissionEvidence.message }]
            : []),
        ...terminalCommands.flatMap((command): LedCardAlert[] =>
            command.status === 'failed'
                ? [{ kind: 'raw', message: command.message }]
                : command.status === 'timed_out'
                  ? [{ kind: 'command-timed-out', reason: command.reason }]
                  : [],
        ),
    ];
    const warnings: LedCardAlert[] = [
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
    const information: LedCardAlert[] = [
        ...(submitting ? [{ kind: 'submitting' as const }] : []),
        ...(activeCommand
            ? [{ kind: 'requested' as const, power: activeCommand.requestedState.power }]
            : []),
        ...terminalCommands.flatMap((command): LedCardAlert[] =>
            command.status === 'confirmed'
                ? [{ kind: 'command-confirmed', time: terminalTimestamp(command) }]
                : [],
        ),
    ];
    const messages = [...errors, ...warnings, ...information];
    const hasReportedPower = device.reportedState.power !== undefined;

    return {
        deviceEvidence: [
            { label: 'availability', durability: device.availabilityDurability },
            { label: 'health', durability: device.healthDurability },
            ...(device.observationStatus.power
                ? [
                      {
                          label: 'power' as const,
                          durability: device.observationStatus.power.durability,
                      },
                  ]
                : []),
        ],
        commandEvidence: [
            ...(activeCommand ? [{ context: 'active' as const, command: activeCommand }] : []),
            ...(recentCommand ? [{ context: 'recent' as const, command: recentCommand }] : []),
            ...(additionalCommand
                ? [{ context: 'correlated' as const, command: additionalCommand }]
                : []),
            ...(admissionEvidence
                ? [{ context: 'admission' as const, command: admissionEvidence }]
                : []),
        ],
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
