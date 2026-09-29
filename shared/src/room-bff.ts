import { type Static, Type } from '@sinclair/typebox';

import { liveTelemetrySampleProjectionSchema } from './history';
import { deviceProjectionSchema, roomSnapshotProjectionSchema } from './projections';
import {
    commandsUpdatedMessageSchema,
    isRoomRealtimeServerMessage,
    isRoomSnapshotProjection,
    platformUpdatedMessageSchema,
    roomRealtimeServerMessageSchema,
} from './realtime';
import {
    isUserHistoryProjection,
    userHistoryDeltaSchema,
    userHistoryProjectionSchema,
} from './user-history';
import { isoTimestampSchema, isSchema } from './validation';

/** API presentation only: runtime projections/publications keep raw recentEvents. */
export const roomBffSnapshotSchema = Type.Object(
    {
        ...Type.Omit(roomSnapshotProjectionSchema, ['recentEvents']).properties,
        userHistory: userHistoryProjectionSchema,
    },
    { additionalProperties: false },
);
export type RoomBffSnapshot = Static<typeof roomBffSnapshotSchema>;

const deviceUpdatedBase = {
    messageType: Type.Literal('device.updated'),
    previousRevision: Type.Integer({ minimum: 0 }),
    revision: Type.Integer({ minimum: 1 }),
    sentAt: isoTimestampSchema,
    payload: deviceProjectionSchema,
};
const commandsPayloadSchema = Type.Object(
    {
        ...Type.Omit(commandsUpdatedMessageSchema.properties.payload, ['recentEvents']).properties,
        userHistory: Type.Optional(userHistoryDeltaSchema),
    },
    { additionalProperties: false },
);
const platformPayloadSchema = Type.Object(
    {
        ...Type.Omit(platformUpdatedMessageSchema.properties.payload, ['recentEvents']).properties,
        userHistory: Type.Optional(userHistoryDeltaSchema),
    },
    { additionalProperties: false },
);

export const roomBffRealtimeServerMessageSchema = Type.Union([
    Type.Object(
        { ...roomRealtimeServerMessageSchema.properties, payload: roomBffSnapshotSchema },
        { additionalProperties: false },
    ),
    Type.Union([
        Type.Object(deviceUpdatedBase, { additionalProperties: false }),
        Type.Object(
            { ...deviceUpdatedBase, userHistory: userHistoryDeltaSchema },
            { additionalProperties: false },
        ),
        Type.Object(
            { ...deviceUpdatedBase, telemetrySample: liveTelemetrySampleProjectionSchema },
            { additionalProperties: false },
        ),
    ]),
    Type.Object(
        { ...commandsUpdatedMessageSchema.properties, payload: commandsPayloadSchema },
        { additionalProperties: false },
    ),
    Type.Object(
        { ...platformUpdatedMessageSchema.properties, payload: platformPayloadSchema },
        { additionalProperties: false },
    ),
]);
export type RoomBffRealtimeServerMessage = Static<typeof roomBffRealtimeServerMessageSchema>;

export function isRoomBffSnapshot(value: unknown): value is RoomBffSnapshot {
    if (!isSchema(roomBffSnapshotSchema, value)) {
        return false;
    }

    const { userHistory, ...projection } = value;

    // Reuse the platform's semantic invariants, without interpreting user items.
    return (
        isUserHistoryProjection(userHistory) &&
        isRoomSnapshotProjection({ ...projection, recentEvents: [] })
    );
}

export function isRoomBffRealtimeServerMessage(
    value: unknown,
): value is RoomBffRealtimeServerMessage {
    if (!isSchema(roomBffRealtimeServerMessageSchema, value)) {
        return false;
    }

    switch (value.messageType) {
        case 'room.snapshot': {
            const { userHistory, ...payload } = value.payload;

            return (
                isUserHistoryProjection(userHistory) &&
                isRoomRealtimeServerMessage({
                    ...value,
                    payload: { ...payload, recentEvents: [] },
                })
            );
        }

        case 'device.updated': {
            const userHistory = 'userHistory' in value ? value.userHistory : undefined;
            const message = {
                messageType: value.messageType,
                previousRevision: value.previousRevision,
                revision: value.revision,
                sentAt: value.sentAt,
                payload: value.payload,
                ...('telemetrySample' in value ? { telemetrySample: value.telemetrySample } : {}),
            };

            return (
                (userHistory === undefined ||
                    (isUserHistoryProjection(userHistory) &&
                        userHistory.every(
                            (item) =>
                                'deviceId' in item && item.deviceId === value.payload.deviceId,
                        ))) &&
                isRoomRealtimeServerMessage(message)
            );
        }

        default: {
            const { userHistory, ...payload } = value.payload;

            return (
                (userHistory === undefined || isUserHistoryProjection(userHistory)) &&
                isRoomRealtimeServerMessage({ ...value, payload })
            );
        }
    }
}
