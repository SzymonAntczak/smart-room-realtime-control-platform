import type { CommandTimedOutEvent } from '@smart-room/contracts/events';

export const setPowerTimeoutMs = 5_000;

export function createSetPowerTimeoutEvent({
    generateEventId,
    deadlineAt,
    deviceId,
    commandId,
}: {
    generateEventId(): string;
    deadlineAt: string;
    deviceId: string;
    commandId: string;
}): CommandTimedOutEvent {
    return {
        eventId: generateEventId(),
        eventType: 'command.timed_out',
        occurredAt: deadlineAt,
        source: 'backend',
        deviceId,
        commandId,
        payload: { timeoutMs: setPowerTimeoutMs, reason: 'confirmation_not_received' },
    };
}
