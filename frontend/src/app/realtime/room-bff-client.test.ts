import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { describe, expect, it } from 'vitest';

import { validateRoomBffRealtimeMessage, validateRoomBffSnapshot } from './room-bff-client';

const { snapshot, powerChange, gap } = createUserHistoryFixtures();
const baseline = {
    messageType: 'room.snapshot',
    revision: 0,
    sentAt: snapshot.updatedAt,
    payload: snapshot,
};

describe('BFF realtime client boundary (AC-4, AC-5)', () => {
    it('exposes only validated snapshots and deltas, preserving identity', () => {
        expect(validateRoomBffSnapshot(snapshot)).toEqual({ kind: 'snapshot', snapshot });
        expect(validateRoomBffRealtimeMessage(baseline)).toEqual({
            kind: 'message',
            message: baseline,
        });
        const delta = {
            messageType: 'device.updated',
            previousRevision: 0,
            revision: 1,
            sentAt: snapshot.updatedAt,
            payload: snapshot.devices[0],
            userHistory: [powerChange],
        };
        expect(validateRoomBffRealtimeMessage(delta)).toEqual({ kind: 'message', message: delta });
    });

    it('rejects malformed history in an otherwise valid room baseline without returning partial state', () => {
        for (const item of [
            { ...powerChange, commandId: 'cmd-1' },
            { ...powerChange, payload: {} },
            { ...powerChange, occurredAt: 'invalid' },
            { ...gap, outageStartedAt: '2026-09-10T11:00:00Z' },
        ]) {
            const payload = { ...snapshot, userHistory: [item] };
            const before = structuredClone(payload);
            expect(validateRoomBffSnapshot(payload)).toEqual({ kind: 'invalid_response' });
            expect(validateRoomBffRealtimeMessage({ ...baseline, payload })).toEqual({
                kind: 'invalid_response',
            });
            expect(payload).toEqual(before);
        }
    });

    it('rejects raw wire shapes and invalid revisions rather than accepting a compatibility format', () => {
        const raw: Partial<typeof snapshot> = { ...snapshot };
        delete raw.userHistory;
        expect(validateRoomBffSnapshot({ ...raw, recentEvents: [] })).toEqual({
            kind: 'invalid_response',
        });
        expect(validateRoomBffRealtimeMessage({ ...baseline, revision: 1 })).toEqual({
            kind: 'invalid_response',
        });
        expect(
            validateRoomBffRealtimeMessage({ ...baseline, sentAt: '2026-09-10T12:00:00+02:00' }),
        ).toEqual({ kind: 'invalid_response' });
        expect(validateRoomBffRealtimeMessage(null)).toEqual({ kind: 'invalid_response' });
    });
});
