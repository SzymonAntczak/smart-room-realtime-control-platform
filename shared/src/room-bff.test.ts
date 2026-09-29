import { describe, expect, it } from 'vitest';

import { isRecentEventsProjection, isSignificantFactPage } from './history';
import { createHistoryIdentityFixtures } from './history-fixtures';
import { isRoomRealtimeServerMessage } from './realtime';
import { isRoomBffRealtimeServerMessage, isRoomBffSnapshot } from './room-bff';
import { isUserHistoryPage } from './user-history';
import { createUserHistoryFixtures } from './user-history-fixtures';

const { snapshot, powerChange, page } = createUserHistoryFixtures();
const timestamp = snapshot.updatedAt;
const baseline = {
    messageType: 'room.snapshot',
    revision: 0,
    sentAt: timestamp,
    payload: snapshot,
};
const deviceDelta = {
    messageType: 'device.updated',
    previousRevision: 0,
    revision: 1,
    sentAt: timestamp,
    payload: snapshot.devices[0],
    userHistory: [powerChange],
};
const commandDelta = {
    messageType: 'commands.updated',
    previousRevision: 1,
    revision: 2,
    sentAt: timestamp,
    payload: {
        devices: snapshot.devices,
        activeCommands: [],
        recentCommands: [],
        userHistory: [powerChange],
    },
};
const platformDelta = {
    messageType: 'platform.updated',
    previousRevision: 2,
    revision: 3,
    sentAt: timestamp,
    payload: { storage: snapshot.platform.storage },
};

describe('BFF presentation contracts', () => {
    it('validates the new baseline and all delta types, retaining HTTP/SSE source identity', () => {
        expect(isRoomBffSnapshot(snapshot)).toBe(true);

        for (const message of [baseline, deviceDelta, commandDelta, platformDelta]) {
            expect(isRoomBffRealtimeServerMessage(message)).toBe(true);
        }

        expect(isUserHistoryPage(page)).toBe(true);
        expect(page.items[0]?.recordId).toBe(deviceDelta.userHistory[0]?.recordId);
        expect(page.items[0]?.storageSequence).toBe(deviceDelta.userHistory[0]?.storageSequence);
        expect(page.items[0]?.occurredAt).toBe(deviceDelta.userHistory[0]?.occurredAt);
    });

    it('preserves command progress even when it contributes no user-history entry', () => {
        const device = snapshot.devices[0];
        const requestedCommand = {
            commandId: 'cmd-1',
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
            requestedAt: timestamp,
            status: 'accepted',
            durability: 'durable',
            lifecycleDurability: 'durable',
        };
        const payload = {
            devices: [{ ...device, activeCommandId: 'cmd-1' }],
            activeCommands: [requestedCommand],
            recentCommands: [],
        };
        expect(isRoomBffRealtimeServerMessage({ ...commandDelta, payload })).toBe(true);
        expect(
            isRoomBffRealtimeServerMessage({
                ...commandDelta,
                payload: { ...payload, devices: snapshot.devices },
            }),
        ).toBe(false);
        expect(
            isRoomBffRealtimeServerMessage({
                ...commandDelta,
                payload: {
                    ...payload,
                    activeCommands: [requestedCommand, { ...requestedCommand, commandId: 'cmd-2' }],
                },
            }),
        ).toBe(false);
    });

    it('rejects invalid baseline revisions, revision steps, timestamps and raw feed fields', () => {
        expect(isRoomBffRealtimeServerMessage({ ...baseline, revision: 1 })).toBe(false);
        expect(isRoomBffRealtimeServerMessage({ ...deviceDelta, revision: 2 })).toBe(false);
        expect(
            isRoomBffRealtimeServerMessage({ ...deviceDelta, sentAt: '2026-09-10T12:00:00+02:00' }),
        ).toBe(false);
        expect(isRoomBffSnapshot({ ...snapshot, recentEvents: [] })).toBe(false);
        expect(isRoomBffRealtimeServerMessage({ ...deviceDelta, recentEvents: [] })).toBe(false);
        expect(
            isRoomBffRealtimeServerMessage({
                ...commandDelta,
                payload: { ...commandDelta.payload, recentEvents: [] },
            }),
        ).toBe(false);
        expect(
            isRoomBffRealtimeServerMessage({
                ...platformDelta,
                payload: { ...platformDelta.payload, recentEvents: [] },
            }),
        ).toBe(false);
    });

    it('rejects inconsistent storage and dangling command references without copying platform rules', () => {
        expect(
            isRoomBffSnapshot({
                ...snapshot,
                devices: snapshot.devices.map((device) => ({
                    ...device,
                    activeCommandId: 'absent',
                })),
            }),
        ).toBe(false);
        expect(
            isRoomBffRealtimeServerMessage({
                ...platformDelta,
                payload: { storage: { ...snapshot.platform.storage, historyGenerationId: null } },
            }),
        ).toBe(false);
        expect(
            isRoomBffSnapshot({
                ...snapshot,
                devices: snapshot.devices.map((device) => ({ ...device, availability: 'offline' })),
            }),
        ).toBe(false);
    });

    it('enforces nonempty bounded additions and device identity without confusing live sequences with the later watermark', () => {
        expect(isRoomBffRealtimeServerMessage({ ...deviceDelta, userHistory: [] })).toBe(false);
        expect(
            isRoomBffRealtimeServerMessage({
                ...commandDelta,
                payload: { ...commandDelta.payload, userHistory: [] },
            }),
        ).toBe(false);
        expect(
            isRoomBffRealtimeServerMessage({
                ...deviceDelta,
                userHistory: [{ ...powerChange, deviceId: 'other-device' }],
            }),
        ).toBe(false);
        expect(
            isRoomBffRealtimeServerMessage({
                ...deviceDelta,
                userHistory: [{ ...powerChange, storageSequence: 9 }],
            }),
        ).toBe(true);
        expect(isRoomBffSnapshot({ ...snapshot, userHistory: [] })).toBe(true);
        const item: Record<string, unknown> = { ...powerChange };
        delete item.storageSequence;
        expect(
            isRoomBffRealtimeServerMessage({
                ...deviceDelta,
                userHistory: [{ ...item, durability: 'volatile' }],
            }),
        ).toBe(true);
    });

    it('keeps telemetry separate from user additions and retains its device matching rule', () => {
        const delta: Partial<typeof deviceDelta> = { ...deviceDelta };
        delete delta.userHistory;
        const { telemetrySample } = createHistoryIdentityFixtures();
        const sample = { ...telemetrySample, deviceId: 'led-main' };
        expect(isRoomBffRealtimeServerMessage({ ...delta, telemetrySample: sample })).toBe(true);
        expect(isRoomBffRealtimeServerMessage({ ...deviceDelta, telemetrySample: sample })).toBe(
            false,
        );
        expect(isRoomBffRealtimeServerMessage({ ...delta, telemetrySample })).toBe(false);
    });

    it('leaves raw platform contracts intact and separate from the future BFF wire format', () => {
        const raw = createHistoryIdentityFixtures();
        expect(isRecentEventsProjection(raw.recentEvents)).toBe(true);
        expect(isSignificantFactPage(raw.significantFactPage)).toBe(true);
        expect(isRoomRealtimeServerMessage(baseline)).toBe(false);
        const projection: Partial<typeof snapshot> = { ...snapshot };
        delete projection.userHistory;
        const rawBaseline = {
            ...baseline,
            payload: { ...projection, recentEvents: raw.recentEvents },
        };
        expect(isRoomRealtimeServerMessage(rawBaseline)).toBe(true);
        expect(isRoomBffRealtimeServerMessage(rawBaseline)).toBe(false);
    });
});
