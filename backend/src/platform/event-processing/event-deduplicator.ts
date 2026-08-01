export const defaultDeduplicationRetentionMs = 10 * 60 * 1000;
export const defaultDeduplicationEntryLimit = 1000;

export interface EventDeduplicationClock {
    now(): string;
}

export interface EventDeduplicator {
    check(eventId: string): EventDeduplicationCheck;
    remember(eventId: string): string[];
}

export interface EventDeduplicationCheck {
    isDuplicate: boolean;
    checkedAt: string;
}

export function createEventDeduplicator({
    clock,
    retentionMs = defaultDeduplicationRetentionMs,
    entryLimit = defaultDeduplicationEntryLimit,
}: {
    clock: EventDeduplicationClock;
    retentionMs?: number;
    entryLimit?: number;
}): EventDeduplicator {
    const entries = new Map<string, number>();

    return {
        check(eventId) {
            const checkedAt = clock.now();
            removeExpiredEntries(Date.parse(checkedAt));
            return {
                isDuplicate: entries.has(eventId),
                checkedAt,
            };
        },
        remember(eventId) {
            const acceptedAt = nowMs();
            removeExpiredEntries(acceptedAt);
            entries.set(eventId, acceptedAt);
            const evictedEventIds: string[] = [];
            while (entries.size > entryLimit) {
                const oldestEventId = entries.keys().next().value;
                if (oldestEventId === undefined) break;
                entries.delete(oldestEventId);
                evictedEventIds.push(oldestEventId);
            }
            return evictedEventIds;
        },
    };

    function removeExpiredEntries(currentTimeMs: number): void {
        const expiresBefore = currentTimeMs - retentionMs;
        for (const [eventId, acceptedAt] of entries) {
            if (acceptedAt > expiresBefore) break;
            entries.delete(eventId);
        }
    }

    function nowMs(): number {
        return Date.parse(clock.now());
    }
}
