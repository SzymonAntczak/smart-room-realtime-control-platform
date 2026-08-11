import { describe, expect, it } from 'vitest';

import {
    assertMockRoomSnapshot,
    parseMockSetPowerCommandRequest,
    serializeMockSseMessage,
} from './mock-bff-contracts';

const roomSnapshot = {
    roomName: 'Smart Room',
    updatedAt: '2026-06-08T09:30:00Z',
    devices: [],
    activeCommands: [],
    recentCommands: [],
} as const;

describe('mock BFF shared-contract boundary', () => {
    it('accepts a valid room snapshot fixture and rejects an invalid one', () => {
        expect(assertMockRoomSnapshot(roomSnapshot)).toEqual(roomSnapshot);
        expect(() =>
            assertMockRoomSnapshot({ ...roomSnapshot, updatedAt: 'not-a-timestamp' }),
        ).toThrow('room snapshot did not match the shared contract');
    });

    it('serializes only valid SSE messages using their contract message type', () => {
        const message = {
            messageType: 'room.snapshot',
            revision: 0,
            sentAt: '2026-06-08T09:30:00Z',
            payload: roomSnapshot,
        } as const;
        const serialized = serializeMockSseMessage(message);

        expect(serialized).toMatch(/^event: room\.snapshot\ndata: /);
        expect(JSON.parse(serialized.slice('event: room.snapshot\ndata: '.length))).toEqual(message);
        expect(() =>
            serializeMockSseMessage({
                messageType: 'room.snapshot',
                revision: 1,
                sentAt: '2026-06-08T09:30:00Z',
                payload: roomSnapshot,
            }),
        ).toThrow('SSE message did not match the shared contract');
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
