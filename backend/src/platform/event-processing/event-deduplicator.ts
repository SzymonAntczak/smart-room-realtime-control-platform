import { normalizeIsoTimestamp } from '@smart-room/contracts/validation';

export const defaultDeduplicationRetentionMs = 10 * 60 * 1000;
export const defaultDeduplicationEntryLimit = 1000;

export interface EventDeduplicationClock {
    now(): string;
}

export interface EventDeduplicator {
    inspect(eventId: string): EventDeduplicationCheck;
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
    assertValidConfig(retentionMs, entryLimit);
    const entries = new Map<string, number>();

    return {
        inspect(eventId) {
            const checkedAt = readClock();
            const acceptedAt = entries.get(eventId);

            return {
                isDuplicate:
                    acceptedAt !== undefined && acceptedAt > Date.parse(checkedAt) - retentionMs,
                checkedAt,
            };
        },
        check(eventId) {
            const checkedAt = readClock();
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

                if (oldestEventId === undefined) {
                    break;
                }

                entries.delete(oldestEventId);
                evictedEventIds.push(oldestEventId);
            }

            return evictedEventIds;
        },
    };

    function removeExpiredEntries(currentTimeMs: number): void {
        const expiresBefore = currentTimeMs - retentionMs;

        for (const [eventId, acceptedAt] of entries) {
            if (acceptedAt > expiresBefore) {
                break;
            }

            entries.delete(eventId);
        }
    }

    function nowMs(): number {
        return Date.parse(readClock());
    }

    function readClock(): string {
        const timestamp = normalizeIsoTimestamp(clock.now());

        if (!timestamp) {
            throw new Error('Event deduplication clock returned an invalid ISO timestamp.');
        }

        return timestamp;
    }
}

function assertValidConfig(retentionMs: number, entryLimit: number): void {
    if (!Number.isFinite(retentionMs) || retentionMs < 0) {
        throw new Error('Event deduplication retentionMs must be a finite non-negative number.');
    }

    if (!Number.isSafeInteger(entryLimit) || entryLimit < 1) {
        throw new Error('Event deduplication entryLimit must be a positive safe integer.');
    }
}
