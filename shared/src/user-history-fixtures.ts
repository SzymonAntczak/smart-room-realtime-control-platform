import type { DurableSignificantFactProjection } from './history';
import { createHistoryIdentityFixtures } from './history-fixtures';
import type { RoomBffSnapshot } from './room-bff';
import type { DurableUserHistoryItem, UserHistoryPage } from './user-history';

/** Shared boundary examples: identity/time/sequence originate in the raw fixture. */
export function createUserHistoryFixtures() {
    const raw = createHistoryIdentityFixtures();
    const rawPowerFact = {
        recordId: `rec:v1:sha256:${'c'.repeat(64)}`,
        occurredAt: raw.recentEvent.occurredAt,
        source: 'simulator-adapter',
        durability: 'durable',
        storageSequence: 7,
        deviceId: 'led-main',
        eventType: 'device.state.reported',
        payload: { reportedState: { power: 'on' } },
    } as const satisfies DurableSignificantFactProjection;
    const common = {
        recordId: rawPowerFact.recordId,
        occurredAt: rawPowerFact.occurredAt,
        source: rawPowerFact.source,
        durability: rawPowerFact.durability,
        storageSequence: rawPowerFact.storageSequence,
        deviceId: rawPowerFact.deviceId,
        deviceName: 'Main LED',
    };
    const powerChange = {
        ...common,
        kind: 'power_changed',
        previous: 'off',
        current: 'on',
    } as const satisfies DurableUserHistoryItem;
    const availabilityChange = {
        ...common,
        kind: 'availability_changed',
        previous: 'online',
        current: 'offline',
    } as const satisfies DurableUserHistoryItem;
    const healthChange = {
        ...common,
        kind: 'health_changed',
        previous: 'healthy',
        current: 'degraded',
    } as const satisfies DurableUserHistoryItem;
    const failure = {
        ...common,
        kind: 'attempt_failed',
        requestedPower: 'on',
    } as const satisfies DurableUserHistoryItem;
    const timeout = {
        ...common,
        kind: 'confirmation_missing',
        requestedPower: 'on',
    } as const satisfies DurableUserHistoryItem;
    const gap = {
        recordId: raw.recentEvent.recordId,
        occurredAt: raw.recentEvent.occurredAt,
        source: 'backend',
        durability: 'durable',
        storageSequence: 7,
        kind: 'history_gap',
        outageStartedAt: '2026-09-10T09:59:00.000Z',
        outageEndedAt: raw.recentEvent.occurredAt,
    } as const satisfies DurableUserHistoryItem;
    const page: UserHistoryPage = {
        ...raw.significantFactPage,
        items: [powerChange],
        completeness: 'retained_evidence_only',
    };
    const snapshot: RoomBffSnapshot = {
        roomName: 'Smart Room',
        updatedAt: common.occurredAt,
        devices: [
            {
                deviceId: common.deviceId,
                name: common.deviceName,
                role: 'led-output',
                availability: 'online',
                availabilityChangedAt: common.occurredAt,
                availabilityDurability: 'durable',
                health: 'healthy',
                healthChangedAt: common.occurredAt,
                healthDurability: 'durable',
                reportedState: { power: 'on' },
                observationStatus: {
                    power: {
                        freshness: 'unknown',
                        lastObservedAt: common.occurredAt,
                        durability: 'durable',
                    },
                },
                commandAvailability: { policy: 'allow' },
            },
        ],
        activeCommands: [],
        recentCommands: [],
        userHistory: [powerChange],
        platform: {
            storage: {
                status: 'available',
                changedAt: common.occurredAt,
                historyGenerationId: page.historyGenerationId,
                storedThroughSequence: page.throughSequence,
            },
        },
    };

    return {
        rawPowerFact,
        powerChange,
        availabilityChange,
        healthChange,
        failure,
        timeout,
        gap,
        page,
        snapshot,
        items: [powerChange, availabilityChange, healthChange, failure, timeout, gap],
    };
}
