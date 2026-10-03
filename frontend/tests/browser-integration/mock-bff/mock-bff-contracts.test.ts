import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { describe, expect, it } from 'vitest';

import {
    assertMockRejectedCommandResponse,
    assertMockRoomSnapshot,
    parseMockSetPowerCommandRequest,
    serializeMockSseMessage,
} from './mock-bff-contracts';
import {
    createCommandsUpdatedMessage,
    createDeviceUpdatedMessage,
    createOnlineLedDeviceProjection,
    createOnlineLedRoomSnapshot,
    createOnlineTemperatureDeviceProjection,
    createOnlineTemperatureRoomSnapshot,
    createPendingLedCommand,
    createPendingLedDeviceProjection,
    createPlatformUpdatedMessage,
    createTemperatureDeviceUpdatedMessage,
} from './mock-bff-fixtures';
import { MockRoomScenario } from './mock-room-scenario';
import { createHealthHistoryItem, createPowerHistoryItem } from './recent-feed-fixtures';

describe('mock BFF shared-contract boundary', () => {
    it('accepts the online LED fixture and rejects an invalid snapshot', () => {
        const roomSnapshot = createOnlineLedRoomSnapshot();

        expect(assertMockRoomSnapshot(roomSnapshot)).toEqual(roomSnapshot);
        expect(() =>
            assertMockRoomSnapshot({ ...roomSnapshot, updatedAt: 'not-a-timestamp' }),
        ).toThrow('room snapshot did not match the shared contract');
    });

    it('serializes only valid SSE messages using their contract message type', () => {
        const roomSnapshot = createOnlineLedRoomSnapshot();
        const message = {
            messageType: 'room.snapshot',
            revision: 0,
            sentAt: '2026-06-08T09:30:00Z',
            payload: roomSnapshot,
        } as const;
        const serialized = serializeMockSseMessage(message);

        expect(serialized).toMatch(/^event: room\.snapshot\ndata: /);
        expect(JSON.parse(serialized.slice('event: room.snapshot\ndata: '.length))).toEqual(
            message,
        );
        expect(() =>
            serializeMockSseMessage({
                messageType: 'room.snapshot',
                revision: 1,
                sentAt: '2026-06-08T09:30:00Z',
                payload: roomSnapshot,
            }),
        ).toThrow('SSE message did not match the shared contract');
    });

    it('accepts the shared history fixture in both snapshot and SSE feed boundaries', () => {
        const fixtures = createUserHistoryFixtures();
        const baseRoomSnapshot = createOnlineLedRoomSnapshot();
        const roomSnapshot = {
            ...baseRoomSnapshot,
            userHistory: [fixtures.gap],
            platform: {
                storage: {
                    ...baseRoomSnapshot.platform.storage,
                    storedThroughSequence: fixtures.page.throughSequence,
                },
            },
        };
        const message = {
            messageType: 'platform.updated',
            previousRevision: 0,
            revision: 1,
            sentAt: '2026-09-10T10:01:00.000Z',
            payload: {
                storage: roomSnapshot.platform.storage,
                userHistory: [fixtures.gap],
            },
        } as const;

        expect(assertMockRoomSnapshot(roomSnapshot).userHistory[0]?.recordId).toBe(
            fixtures.gap.recordId,
        );
        expect(serializeMockSseMessage(message)).toContain(fixtures.gap.recordId);
    });

    it('creates revision-linked device and command updates', () => {
        const deviceUpdate = createDeviceUpdatedMessage(0);
        const commandsUpdate = createCommandsUpdatedMessage(deviceUpdate.revision);

        expect(deviceUpdate.revision).toBe(1);
        expect(commandsUpdate.previousRevision).toBe(1);
        expect(commandsUpdate.revision).toBe(2);
        expect(() => serializeMockSseMessage(deviceUpdate)).not.toThrow();
        expect(() => serializeMockSseMessage(commandsUpdate)).not.toThrow();
    });

    it('accepts a multi-sensor temperature snapshot and applies its device update', () => {
        const scenario = new MockRoomScenario();
        const roomSnapshot = createOnlineTemperatureRoomSnapshot();

        expect(assertMockRoomSnapshot(roomSnapshot)).toEqual(roomSnapshot);
        scenario.setSnapshot(roomSnapshot);

        expect(() => scenario.applyUpdate(createTemperatureDeviceUpdatedMessage(0))).not.toThrow();
        const snapshotMessage = scenario.snapshotMessage();

        expect(snapshotMessage.payload.devices).toHaveLength(2);
    });

    it('rejects a revision gap before changing the room scenario', () => {
        const scenario = new MockRoomScenario();

        scenario.applyUpdate(createDeviceUpdatedMessage(0));

        expect(() => scenario.applyUpdate(createCommandsUpdatedMessage(0))).toThrow(
            'expected previous revision 1',
        );
        expect(scenario.snapshotMessage().revision).toBe(0);
        expect(() => scenario.applyUpdate(createCommandsUpdatedMessage(1))).not.toThrow();
    });

    it('does not advance the revision when an update references an unknown device', () => {
        const scenario = new MockRoomScenario();
        const unknownDevice = { ...createOnlineLedDeviceProjection(), deviceId: 'led-secondary' };
        const initialSnapshot = scenario.snapshotMessage();

        expect(() => scenario.applyUpdate(createDeviceUpdatedMessage(0, unknownDevice))).toThrow(
            'update references unknown device led-secondary',
        );
        expect(scenario.snapshotMessage()).toEqual(initialSnapshot);
        expect(() => scenario.applyUpdate(createDeviceUpdatedMessage(0))).not.toThrow();
    });

    it('rejects a valid delta that would make the merged snapshot invalid without changing state', () => {
        const baseSnapshot = createOnlineLedRoomSnapshot();
        const scenario = new MockRoomScenario();
        scenario.setSnapshot({
            ...baseSnapshot,
            devices: [createPendingLedDeviceProjection()],
            activeCommands: [createPendingLedCommand()],
        });
        const initialSnapshot = scenario.snapshotMessage();

        expect(() =>
            scenario.applyUpdate(createDeviceUpdatedMessage(0, createOnlineLedDeviceProjection())),
        ).toThrow('room snapshot did not match the shared contract');
        expect(scenario.snapshotMessage()).toEqual(initialSnapshot);
        expect(scenario.currentRevision()).toBe(0);
    });

    it('keeps realtime feed additions in snapshots and preserves them across watermark updates', () => {
        const scenario = new MockRoomScenario();
        const stateFact = createPowerHistoryItem(21, '2026-06-08T09:30:01Z', 1, 'on');

        scenario.applyUpdate(
            createDeviceUpdatedMessage(
                0,
                { ...createOnlineLedDeviceProjection(), reportedState: { power: 'on' } },
                [stateFact],
                stateFact.occurredAt,
            ),
        );

        expect(scenario.snapshotMessage().payload.userHistory).toEqual([stateFact]);

        scenario.applyUpdate(createPlatformUpdatedMessage(1, 1, '2026-06-08T09:30:02Z'));

        expect(scenario.snapshotMessage().payload.userHistory).toEqual([stateFact]);
        expect(scenario.snapshotMessage().payload.platform.storage.storedThroughSequence).toBe(1);
        expect(scenario.snapshotMessage().payload.platform.storage.changedAt).toBe(
            '2026-06-08T09:30:00Z',
        );
    });

    it('deduplicates feed records and keeps the newest twenty in shared feed order', () => {
        const baseSnapshot = createOnlineTemperatureRoomSnapshot();
        const initialEvents = Array.from({ length: 20 }, (_, index) => {
            const second = String(index).padStart(2, '0');

            return createHealthHistoryItem(
                index + 1,
                'healthy',
                'degraded',
                `2026-06-08T09:30:${second}Z`,
                index + 1,
            );
        }).reverse();
        const scenario = new MockRoomScenario();
        scenario.setSnapshot({
            ...baseSnapshot,
            updatedAt: '2026-06-08T09:31:00Z',
            userHistory: initialEvents,
            platform: {
                storage: {
                    status: 'available',
                    changedAt: '2026-06-08T09:31:00Z',
                    historyGenerationId: 'mock-history-generation',
                    storedThroughSequence: 20,
                },
            },
        });

        const duplicate = createHealthHistoryItem(
            20,
            'healthy',
            'degraded',
            '2026-06-08T09:30:19Z',
            20,
        );
        const newest = createHealthHistoryItem(
            21,
            'degraded',
            'healthy',
            '2026-06-08T09:30:22Z',
            21,
        );
        scenario.applyUpdate(
            createTemperatureDeviceUpdatedMessage(
                0,
                createOnlineTemperatureDeviceProjection(),
                [newest, duplicate],
                newest.occurredAt,
            ),
        );

        const userHistory = scenario.snapshotMessage().payload.userHistory;
        expect(userHistory).toHaveLength(20);
        expect(userHistory[0]?.recordId).toBe(newest.recordId);
        expect(userHistory.some((event) => event.recordId === initialEvents.at(-1)?.recordId)).toBe(
            false,
        );
        expect(userHistory.filter((event) => event.recordId === duplicate.recordId)).toHaveLength(
            1,
        );
    });

    it('accepts only a documented set.power command request', () => {
        expect(
            parseMockSetPowerCommandRequest(
                JSON.stringify({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                }),
            ),
        ).toEqual({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });
        expect(() =>
            parseMockSetPowerCommandRequest(
                JSON.stringify({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                    confirmed: true,
                }),
            ),
        ).toThrow('command request did not match the shared set.power contract');
    });

    it('accepts only a shared-contract rejected command response', () => {
        expect(
            assertMockRejectedCommandResponse({
                commandId: 'mock-command-1',
                status: 'rejected',
                reason: 'command_already_active',
                message: 'Device already has an active command.',
                durability: 'durable',
                lifecycleDurability: 'durable',
            }),
        ).toMatchObject({ status: 'rejected' });
        expect(() =>
            assertMockRejectedCommandResponse({
                commandId: 'mock-command-1',
                status: 'rejected',
                reason: 'command_already_active',
            }),
        ).toThrow('rejected command response did not match the shared contract');
    });
});
