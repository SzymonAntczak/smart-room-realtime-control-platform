import {
    isSignificantFactPage,
    type SignificantFactPage,
    type SignificantFactPageQuery,
} from '@smart-room/contracts/history';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { isRoomSnapshotProjection } from '@smart-room/contracts/realtime';
import {
    isMatchingUserHistoryCursorQueryScope,
    isUserHistoryPage,
    type NormalizedUserHistoryPageQuery,
    type UserHistoryCursorQueryScope,
    type UserHistoryPage,
} from '@smart-room/contracts/user-history';

import type { RoomHistoryReadResult } from '../../platform/history/room-history-reader';

import { createUserHistoryCursorCodec, type UserHistoryCursorCodec } from './user-history-cursor';
import {
    collectTimeoutRequestEvidence,
    createTimeoutEvidence,
    toHistoricalUserHistoryItems,
} from './user-history-facts';

// Stage 4's hard significant-fact retention bound also bounds auxiliary scan work.
const maximumPinnedFactCount = 5_000;

export interface UserHistoryReader {
    readPage(query: NormalizedUserHistoryPageQuery): RoomHistoryReadResult<UserHistoryPage>;
}

export function createUserHistoryReader({
    readSignificantFactPage,
    getRoomSnapshot,
    cursorCodec = createUserHistoryCursorCodec(),
}: {
    readSignificantFactPage(
        query: SignificantFactPageQuery,
    ): RoomHistoryReadResult<SignificantFactPage>;
    getRoomSnapshot(): RoomSnapshotProjection;
    cursorCodec?: UserHistoryCursorCodec;
}): UserHistoryReader {
    return {
        readPage(query) {
            const rawQuery: SignificantFactPageQuery = { pageSize: query.pageSize };
            const scope: UserHistoryCursorQueryScope = {
                dataset: 'user_history',
                order: 'occurred_at_desc',
                pageSize: query.pageSize,
                ...(query.deviceId !== undefined ? { deviceId: query.deviceId } : {}),
                ...(query.from !== undefined ? { from: query.from } : {}),
                ...(query.to !== undefined ? { to: query.to } : {}),
            };

            if (query.cursor !== undefined) {
                const payload = cursorCodec.decode(query.cursor);

                if (!payload) {
                    return {
                        status: 'cursor_error',
                        error: {
                            error: 'invalid_cursor',
                            message: 'The cursor cannot be verified.',
                        },
                    };
                }

                if (!isMatchingUserHistoryCursorQueryScope(payload.scope, scope)) {
                    return {
                        status: 'cursor_error',
                        error: {
                            error: 'cursor_query_mismatch',
                            message: 'The cursor does not match this query.',
                        },
                    };
                }

                rawQuery.cursor = payload.rawCursor;
            }

            const result = readSignificantFactPage(rawQuery);

            if (result.status !== 'available') {
                return result;
            }

            const main = result.value;
            const snapshot = getRoomSnapshot();

            if (
                !isSignificantFactPage(main) ||
                main.pageSize !== query.pageSize ||
                !isRoomSnapshotProjection(snapshot)
            ) {
                return { status: 'invalid_internal_data' };
            }

            const deviceNames = new Map(
                snapshot.devices.map((device) => [device.deviceId, device.name]),
            );
            const evidence = createTimeoutEvidence(main.items, deviceNames);
            collectTimeoutRequestEvidence(evidence, main.items);

            let previous = main;
            let scannedFacts = main.items.length;

            while (evidence.size > 0 && previous.nextCursor !== null) {
                const auxiliary = readSignificantFactPage({
                    pageSize: query.pageSize,
                    cursor: previous.nextCursor,
                });

                if (auxiliary.status !== 'available') {
                    return auxiliary;
                }

                const page = auxiliary.value;

                if (!isSignificantFactPage(page) || !isFollowingPinnedPage(previous, page)) {
                    return { status: 'invalid_internal_data' };
                }

                scannedFacts += page.items.length;

                if (scannedFacts > maximumPinnedFactCount) {
                    return { status: 'invalid_internal_data' };
                }

                collectTimeoutRequestEvidence(evidence, page.items);
                previous = page;
            }

            const historicalItems = toHistoricalUserHistoryItems(main.items, deviceNames, evidence);
            const page = {
                items: historicalItems.filter((item) => matchesUserHistoryFilters(item, query)),
                historyGenerationId: main.historyGenerationId,
                throughSequence: main.throughSequence,
                retentionAsOf: main.retentionAsOf,
                pageSize: query.pageSize,
                nextCursor:
                    main.nextCursor === null
                        ? null
                        : cursorCodec.encode({
                              version: 1,
                              scope,
                              rawCursor: main.nextCursor,
                          }),
                completeness: 'retained_evidence_only',
            };

            return isUserHistoryPage(page)
                ? { status: 'available', value: page }
                : { status: 'invalid_internal_data' };
        },
    };
}

function matchesUserHistoryFilters(
    item: ReturnType<typeof toHistoricalUserHistoryItems>[number],
    query: NormalizedUserHistoryPageQuery,
): boolean {
    if (
        query.deviceId !== undefined &&
        (!('deviceId' in item) || item.deviceId !== query.deviceId)
    ) {
        return false;
    }

    const occurredAt = Date.parse(item.occurredAt);

    return (
        (query.from === undefined || occurredAt >= Date.parse(query.from)) &&
        (query.to === undefined || occurredAt < Date.parse(query.to))
    );
}

function isFollowingPinnedPage(
    previous: SignificantFactPage,
    current: SignificantFactPage,
): boolean {
    if (
        current.historyGenerationId !== previous.historyGenerationId ||
        current.throughSequence !== previous.throughSequence ||
        current.retentionAsOf !== previous.retentionAsOf ||
        current.pageSize !== previous.pageSize
    ) {
        return false;
    }

    const last = previous.items.at(-1);
    const first = current.items[0];

    return (
        first === undefined ||
        (last !== undefined &&
            (Date.parse(first.occurredAt) < Date.parse(last.occurredAt) ||
                (first.occurredAt === last.occurredAt &&
                    first.storageSequence < last.storageSequence)))
    );
}
