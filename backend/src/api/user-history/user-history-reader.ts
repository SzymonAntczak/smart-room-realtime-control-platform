import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { isRoomSnapshotProjection } from '@smart-room/contracts/realtime';
import {
    isMatchingUserHistoryCursorQueryScope,
    isUserHistoryPage,
    type NormalizedUserHistoryPageQuery,
    type UserHistoryCursorQueryScope,
    type UserHistoryPage,
} from '@smart-room/contracts/user-history';

import {
    isPinnedSignificantFactSnapshot,
    type RoomHistoryReader,
    type RoomHistoryReadResult,
} from '../../platform/history/room-history-reader';

import { createUserHistoryCursorCodec, type UserHistoryCursorCodec } from './user-history-cursor';
import {
    collectTimeoutRequestEvidence,
    createTimeoutEvidence,
    toHistoricalUserHistoryItems,
} from './user-history-facts';

export interface UserHistoryReader {
    readPage(query: NormalizedUserHistoryPageQuery): RoomHistoryReadResult<UserHistoryPage>;
}

export function createUserHistoryReader({
    readPinnedSignificantFactSnapshot,
    getRoomSnapshot,
    cursorCodec = createUserHistoryCursorCodec(),
}: {
    readPinnedSignificantFactSnapshot: RoomHistoryReader['readPinnedSignificantFactSnapshot'];
    getRoomSnapshot(): RoomSnapshotProjection;
    cursorCodec?: UserHistoryCursorCodec;
}): UserHistoryReader {
    return {
        readPage(query) {
            const scope: UserHistoryCursorQueryScope = {
                dataset: 'user_history',
                order: 'occurred_at_desc',
                pageSize: query.pageSize,
                ...(query.deviceId !== undefined ? { deviceId: query.deviceId } : {}),
                ...(query.from !== undefined ? { from: query.from } : {}),
                ...(query.to !== undefined ? { to: query.to } : {}),
            };
            const cursor =
                query.cursor === undefined ? undefined : cursorCodec.decode(query.cursor);

            if (query.cursor !== undefined && cursor === undefined) {
                return {
                    status: 'cursor_error',
                    error: { error: 'invalid_cursor', message: 'The cursor cannot be verified.' },
                };
            }

            if (cursor && !isMatchingUserHistoryCursorQueryScope(cursor.scope, scope)) {
                return {
                    status: 'cursor_error',
                    error: {
                        error: 'cursor_query_mismatch',
                        message: 'The cursor does not match this query.',
                    },
                };
            }

            const result = readPinnedSignificantFactSnapshot(cursor?.bounds);

            if (result.status !== 'available') {
                return result;
            }

            const raw = result.value;
            const snapshot = getRoomSnapshot();

            if (
                !isPinnedSignificantFactSnapshot(raw) ||
                !isRoomSnapshotProjection(snapshot) ||
                (cursor &&
                    Object.keys(cursor.bounds).some(
                        (key) =>
                            raw.bounds[key as keyof typeof raw.bounds] !==
                            cursor.bounds[key as keyof typeof cursor.bounds],
                    ))
            ) {
                return { status: 'invalid_internal_data' };
            }

            const deviceNames = new Map(
                snapshot.devices.map((device) => [device.deviceId, device.name]),
            );
            const evidence = createTimeoutEvidence(raw.items, deviceNames);
            collectTimeoutRequestEvidence(evidence, raw.items);
            const matching = toHistoricalUserHistoryItems(raw.items, deviceNames, evidence)
                .filter(
                    (item) =>
                        matchesUserHistoryFilters(item, query) &&
                        (!cursor ||
                            Date.parse(item.occurredAt) < Date.parse(cursor.position.occurredAt) ||
                            (item.occurredAt === cursor.position.occurredAt &&
                                item.storageSequence < cursor.position.storageSequence)),
                )
                .slice(0, query.pageSize + 1);
            const items = matching.slice(0, query.pageSize);
            const last = items.at(-1);
            const page: UserHistoryPage = {
                items,
                pageSize: query.pageSize,
                historyGenerationId: raw.bounds.historyGenerationId,
                throughSequence: raw.bounds.throughSequence,
                retentionAsOf: raw.bounds.retentionAsOf,
                completeness: 'retained_evidence_only',
                nextCursor:
                    matching.length > query.pageSize && last
                        ? cursorCodec.encode({
                              version: 2,
                              scope,
                              bounds: raw.bounds,
                              position: {
                                  occurredAt: last.occurredAt,
                                  storageSequence: last.storageSequence,
                              },
                          })
                        : null,
            };

            return isUserHistoryPage(page)
                ? { status: 'available', value: page }
                : { status: 'invalid_internal_data' };
        },
    };
}

function matchesUserHistoryFilters(
    item: UserHistoryPage['items'][number],
    query: NormalizedUserHistoryPageQuery,
): boolean {
    return (
        (query.deviceId === undefined ||
            ('deviceId' in item && item.deviceId === query.deviceId)) &&
        (query.from === undefined || Date.parse(item.occurredAt) >= Date.parse(query.from)) &&
        (query.to === undefined || Date.parse(item.occurredAt) < Date.parse(query.to))
    );
}
