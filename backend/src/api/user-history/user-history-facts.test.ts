import type { DurableSignificantFactProjection } from '@smart-room/contracts/history';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { describe, expect, it } from 'vitest';

import {
    createTimeoutEvidence,
    toHistoricalUserHistoryItems,
    toUserHistoryItem,
} from './user-history-facts';

const fixture = createHistoryIdentityFixtures().recentEvent;

if (fixture.durability !== 'durable') {
    throw new Error('Expected durable identity');
}

const identity = {
    recordId: fixture.recordId,
    occurredAt: fixture.occurredAt,
    source: fixture.source,
    durability: fixture.durability,
    storageSequence: fixture.storageSequence,
};
const names = new Map([['temp-desk', 'Desk temperature']]);
const availability: Extract<
    DurableSignificantFactProjection,
    { eventType: 'device.availability.changed' }
> = {
    ...identity,
    eventType: 'device.availability.changed',
    deviceId: 'temp-desk',
    payload: { previousAvailability: 'unknown', availability: 'offline', reason: 'reported' },
    processingEvidence: {
        version: 1,
        kind: 'availability',
        applied: true,
        before: 'online',
        after: 'offline',
    },
};

describe('user history fact mapping', () => {
    it('uses effective before/after values for the same durable entry in live and historical contexts', () => {
        const item = toUserHistoryItem(availability, 'Desk temperature');
        expect(item).toMatchObject({
            kind: 'availability_changed',
            previous: 'online',
            current: 'offline',
            recordId: availability.recordId,
            storageSequence:
                identity.durability === 'durable' ? identity.storageSequence : undefined,
        });
        expect(toHistoricalUserHistoryItems([availability], names, new Map())).toEqual([item]);
    });

    it('omits non-applying and no-value-change evidence while preserving it as an audit fact', () => {
        expect(
            toUserHistoryItem(
                {
                    ...availability,
                    processingEvidence: {
                        version: 1,
                        kind: 'availability',
                        applied: false,
                        before: 'offline',
                        after: 'offline',
                    },
                },
                'Desk temperature',
            ),
        ).toBeUndefined();
        expect(
            toUserHistoryItem(
                {
                    ...availability,
                    processingEvidence: {
                        version: 1,
                        kind: 'availability',
                        applied: true,
                        before: 'offline',
                        after: 'offline',
                    },
                },
                'Desk temperature',
            ),
        ).toBeUndefined();
        const { processingEvidence, ...legacy } = availability;
        void processingEvidence;
        expect(toUserHistoryItem(legacy, 'Desk temperature')).toBeUndefined();
    });

    it('maps power with an unevidenced prior value and health from domain evidence', () => {
        expect(
            toUserHistoryItem(
                {
                    ...identity,
                    eventType: 'device.state.reported',
                    deviceId: 'temp-desk',
                    payload: { reportedState: { power: 'on' } },
                    processingEvidence: {
                        version: 1,
                        kind: 'reported_state',
                        applied: true,
                        before: {},
                        after: { power: 'on' },
                    },
                },
                'Desk temperature',
            ),
        ).toMatchObject({ kind: 'power_changed', previous: null, current: 'on' });
        expect(
            toUserHistoryItem(
                {
                    ...identity,
                    eventType: 'device.health.changed',
                    deviceId: 'temp-desk',
                    payload: { previousHealth: 'unknown', health: 'degraded', reason: 'reported' },
                    processingEvidence: {
                        version: 1,
                        kind: 'health',
                        applied: true,
                        before: 'healthy',
                        after: 'degraded',
                    },
                },
                'Desk temperature',
            ),
        ).toMatchObject({ kind: 'health_changed', previous: 'healthy', current: 'degraded' });
    });

    it('uses retained outcome intent without a request and distinguishes an unknown target from legacy evidence', () => {
        const timeout: Extract<
            DurableSignificantFactProjection,
            { eventType: 'command.timed_out' }
        > = {
            ...identity,
            eventType: 'command.timed_out',
            deviceId: 'temp-desk',
            commandId: 'cmd',
            payload: { timeoutMs: 5000, reason: 'timeout' },
            processingEvidence: {
                version: 1,
                kind: 'command_intent',
                intent: { commandType: 'set.power', requestedState: { power: 'on' } },
            },
        };
        expect(createTimeoutEvidence([timeout], names).size).toBe(0);
        expect(toUserHistoryItem(timeout, 'Desk temperature', 'off')).toMatchObject({
            kind: 'confirmation_missing',
            requestedPower: 'on',
        });
        expect(toHistoricalUserHistoryItems([timeout], names, new Map())).toEqual([
            toUserHistoryItem(timeout, 'Desk temperature'),
        ]);
        expect(
            toUserHistoryItem(
                {
                    ...timeout,
                    processingEvidence: { version: 1, kind: 'command_intent', intent: null },
                },
                'Desk temperature',
                'off',
            ),
        ).toBeUndefined();
        expect(
            toUserHistoryItem(
                {
                    ...timeout,
                    eventType: 'command.failed',
                    payload: { reason: 'rejected', message: 'Rejected' },
                },
                'Desk temperature',
            ),
        ).toMatchObject({ kind: 'attempt_failed', requestedPower: 'on' });
    });

    it('fails invalid present evidence rather than treating it as legacy or returning partial entries', () => {
        const invalid = {
            ...availability,
            processingEvidence: {
                version: 1 as const,
                kind: 'availability' as const,
                before: 'online' as const,
                after: 'offline' as const,
                applied: false,
            },
        };
        expect(() => toHistoricalUserHistoryItems([invalid], names, new Map())).toThrow(
            'Invalid processing evidence',
        );
    });
});
