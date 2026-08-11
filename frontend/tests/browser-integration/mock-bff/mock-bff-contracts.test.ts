import { describe, expect, it } from 'vitest';

import {
    assertMockRoomSnapshot,
    parseMockSetPowerCommandRequest,
    serializeMockSseMessage,
} from './mock-bff-contracts';
import {
    createCommandsUpdatedMessage,
    createDeviceUpdatedMessage,
    createOnlineLedDeviceProjection,
    createOnlineLedRoomSnapshot,
} from './mock-bff-fixtures';
import { MockRoomScenario } from './mock-room-scenario';

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

    it('creates revision-linked device and command updates', () => {
        const deviceUpdate = createDeviceUpdatedMessage(0);
        const commandsUpdate = createCommandsUpdatedMessage(deviceUpdate.revision);

        expect(deviceUpdate.revision).toBe(1);
        expect(commandsUpdate.previousRevision).toBe(1);
        expect(commandsUpdate.revision).toBe(2);
        expect(() => serializeMockSseMessage(deviceUpdate)).not.toThrow();
        expect(() => serializeMockSseMessage(commandsUpdate)).not.toThrow();
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

        expect(() => scenario.applyUpdate(createDeviceUpdatedMessage(0, unknownDevice))).toThrow(
            'update references unknown device led-secondary',
        );
        expect(() => scenario.applyUpdate(createDeviceUpdatedMessage(0))).not.toThrow();
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
});
