import {
    type SetPowerCommandRequest,
    setPowerCommandRequestSchema,
} from '@smart-room/contracts/commands';
import { type RoomSnapshotProjection } from '@smart-room/contracts/projections';
import {
    isRoomRealtimeServerMessage,
    isRoomSnapshotProjection,
    type RoomRealtimeServerMessage,
} from '@smart-room/contracts/realtime';
import { isSchema } from '@smart-room/contracts/validation';

export function assertMockRoomSnapshot(value: unknown): RoomSnapshotProjection {
    if (!isRoomSnapshotProjection(value)) {
        throw new Error('Mock BFF room snapshot did not match the shared contract.');
    }

    return value;
}

export function serializeMockSseMessage(value: unknown): string {
    if (!isRoomRealtimeServerMessage(value)) {
        throw new Error('Mock BFF SSE message did not match the shared contract.');
    }

    return `event: ${value.messageType}\ndata: ${JSON.stringify(value)}\n\n`;
}

export function parseMockSetPowerCommandRequest(body: string): SetPowerCommandRequest {
    let value: unknown;

    try {
        value = JSON.parse(body);
    } catch {
        throw new Error('Mock BFF command request body was not valid JSON.');
    }

    if (!isSchema(setPowerCommandRequestSchema, value)) {
        throw new Error('Mock BFF command request did not match the shared set.power contract.');
    }

    return value;
}

export function assertMockSseMessage(value: unknown): RoomRealtimeServerMessage {
    if (!isRoomRealtimeServerMessage(value)) {
        throw new Error('Mock BFF SSE message did not match the shared contract.');
    }

    return value;
}
