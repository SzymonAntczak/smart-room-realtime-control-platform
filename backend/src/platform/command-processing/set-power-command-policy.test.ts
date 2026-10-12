import { describe, expect, it } from 'vitest';

import { createSetPowerTimeoutEvent, setPowerTimeoutMs } from './set-power-command-policy';

describe('set power timeout policy', () => {
    it('creates the timeout at the original deadline with the shared duration', () => {
        const event = createSetPowerTimeoutEvent({
            generateEventId: () => 'timeout-event',
            deadlineAt: '2026-10-12T10:00:05.000Z',
            deviceId: 'led-main',
            commandId: 'command-1',
        });

        expect(setPowerTimeoutMs).toBe(5_000);
        expect(event).toEqual({
            eventId: 'timeout-event',
            eventType: 'command.timed_out',
            occurredAt: '2026-10-12T10:00:05.000Z',
            source: 'backend',
            deviceId: 'led-main',
            commandId: 'command-1',
            payload: { timeoutMs: 5_000, reason: 'confirmation_not_received' },
        });
    });
});
