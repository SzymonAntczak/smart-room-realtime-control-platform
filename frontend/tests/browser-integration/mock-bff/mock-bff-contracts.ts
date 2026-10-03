import {
    type RejectedCommandResponse,
    rejectedCommandResponseSchema,
    type SetPowerCommandRequest,
    setPowerCommandRequestSchema,
} from '@smart-room/contracts/commands';
import { type RoomBffSnapshot } from '@smart-room/contracts/room-bff';
import {
    isRoomBffRealtimeServerMessage,
    isRoomBffSnapshot,
    type RoomBffRealtimeServerMessage,
} from '@smart-room/contracts/room-bff';
import { isSchema } from '@smart-room/contracts/validation';

export function assertMockRoomSnapshot(value: unknown): RoomBffSnapshot {
    if (!isRoomBffSnapshot(value)) {
        throw new Error('Mock BFF room snapshot did not match the shared contract.');
    }

    return value;
}

export function serializeMockSseMessage(value: unknown): string {
    if (!isRoomBffRealtimeServerMessage(value)) {
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

export function assertMockRejectedCommandResponse(value: unknown): RejectedCommandResponse {
    if (!isSchema(rejectedCommandResponseSchema, value)) {
        throw new Error('Mock BFF rejected command response did not match the shared contract.');
    }

    return value;
}

export function assertMockSseMessage(value: unknown): RoomBffRealtimeServerMessage {
    if (!isRoomBffRealtimeServerMessage(value)) {
        throw new Error('Mock BFF SSE message did not match the shared contract.');
    }

    return value;
}
