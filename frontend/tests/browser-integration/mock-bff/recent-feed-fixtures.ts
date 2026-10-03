import type { DurableUserHistoryItem, UserHistoryPage } from '@smart-room/contracts/user-history';

export function createHealthHistoryItem(
    id: number,
    previous: 'healthy' | 'degraded',
    current: 'healthy' | 'degraded',
    occurredAt: string,
    storageSequence: number,
): DurableUserHistoryItem {
    return {
        ...identity(id, occurredAt, storageSequence),
        kind: 'health_changed',
        previous,
        current,
        source: 'simulator-adapter',
        deviceId: 'temp-desk',
        deviceName: 'Desk Temperature',
    };
}

export function createPowerHistoryItem(
    id: number,
    occurredAt: string,
    storageSequence: number,
    current: 'on' | 'off',
): DurableUserHistoryItem {
    return {
        ...identity(id, occurredAt, storageSequence),
        kind: 'power_changed',
        previous: current === 'on' ? 'off' : 'on',
        current,
        source: 'simulator-adapter',
        deviceId: 'led-main',
        deviceName: 'Main LED',
    };
}

export function createHistoryItems(count: number, firstSequence = 1): DurableUserHistoryItem[] {
    return Array.from({ length: count }, (_, index): DurableUserHistoryItem => {
        const sequence = firstSequence + index;

        return {
            ...identity(
                sequence,
                new Date(Date.parse('2026-09-20T10:00:00.000Z') + sequence * 1000).toISOString(),
                sequence,
            ),
            kind: 'attempt_failed',
            source: 'backend',
            deviceId: 'led-main',
            deviceName: 'Main LED',
            requestedPower: 'on',
        };
    }).reverse();
}

export function createHistoryPage(
    items: DurableUserHistoryItem[],
    nextCursor: string | null = null,
    throughSequence = 10000,
    historyGenerationId = 'mock-history-generation',
): UserHistoryPage {
    return {
        items,
        nextCursor,
        throughSequence,
        historyGenerationId,
        retentionAsOf: '2026-09-29T10:00:00.000Z',
        pageSize: 50,
        completeness: 'retained_evidence_only',
    };
}

function identity(id: number, occurredAt: string, storageSequence: number) {
    return {
        recordId: 'rec:v1:sha256:' + id.toString(16).padStart(64, '0'),
        occurredAt: new Date(occurredAt).toISOString(),
        durability: 'durable' as const,
        storageSequence,
    };
}
