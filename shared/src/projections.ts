import { type Static, Type } from '@sinclair/typebox';

import type { ActiveCommandProjection, TerminalCommandProjection } from './commands';
import { powerStateProjectionSchema } from './commands';
import {
    type CommandAvailability,
    commandAvailabilityPolicies,
    type DeviceAvailability,
    deviceAvailabilityStates,
    type DeviceOperationalHealth,
    deviceOperationalHealthStates,
    type DeviceRole,
    deviceRoles,
    type DeviceState,
    type ObservationFreshness,
    observationFreshnessStates,
} from './devices';
import { isoTimestampSchema, nonEmptyStringSchema } from './validation';

export interface DeviceProjection {
    deviceId: string;
    name: string;
    role: DeviceRole;
    availability: DeviceAvailability;
    availabilityChangedAt: string;
    availabilityReason?: string;
    health: DeviceOperationalHealth;
    healthChangedAt: string;
    healthReason?: string;
    reportedState: DeviceState;
    observationStatus: Record<string, { freshness: ObservationFreshness; lastObservedAt?: string }>;
    commandAvailability: CommandAvailability;
    activeCommandId?: string;
}
export interface RoomSnapshotProjection {
    roomName: string;
    updatedAt: string;
    devices: DeviceProjection[];
    activeCommands: ActiveCommandProjection[];
    recentCommands: TerminalCommandProjection[];
}

const deviceStateSchema = Type.Record(
    Type.String(),
    Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
);
const commandAvailabilitySchema = Type.Object({
    policy: Type.Union(commandAvailabilityPolicies.map((policy) => Type.Literal(policy))),
    reason: Type.Optional(Type.String()),
});
const observationStatusSchema = Type.Record(
    Type.String(),
    Type.Object({
        freshness: Type.Union(observationFreshnessStates.map((value) => Type.Literal(value))),
        lastObservedAt: Type.Optional(isoTimestampSchema),
    }),
);
export const deviceProjectionSchema = Type.Object(
    {
        deviceId: nonEmptyStringSchema,
        name: nonEmptyStringSchema,
        role: Type.Union(deviceRoles.map((role) => Type.Literal(role))),
        availability: Type.Union(deviceAvailabilityStates.map((value) => Type.Literal(value))),
        availabilityChangedAt: isoTimestampSchema,
        availabilityReason: Type.Optional(nonEmptyStringSchema),
        health: Type.Union(deviceOperationalHealthStates.map((value) => Type.Literal(value))),
        healthChangedAt: isoTimestampSchema,
        healthReason: Type.Optional(nonEmptyStringSchema),
        reportedState: deviceStateSchema,
        observationStatus: observationStatusSchema,
        commandAvailability: commandAvailabilitySchema,
        activeCommandId: Type.Optional(nonEmptyStringSchema),
    },
    { additionalProperties: false },
);
const commandProjectionBaseShape = {
    commandId: nonEmptyStringSchema,
    deviceId: nonEmptyStringSchema,
    commandType: Type.Literal('set.power'),
    requestedState: powerStateProjectionSchema,
    requestedAt: isoTimestampSchema,
};
export const activeCommandProjectionSchema = Type.Union([
    Type.Object(
        { ...commandProjectionBaseShape, status: Type.Literal('accepted') },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...commandProjectionBaseShape,
            status: Type.Literal('pending'),
            dispatchedAt: isoTimestampSchema,
        },
        { additionalProperties: false },
    ),
]);
export const terminalCommandProjectionSchema = Type.Union([
    Type.Object(
        {
            ...commandProjectionBaseShape,
            status: Type.Literal('confirmed'),
            dispatchedAt: isoTimestampSchema,
            confirmedAt: isoTimestampSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...commandProjectionBaseShape,
            status: Type.Literal('failed'),
            dispatchedAt: Type.Optional(isoTimestampSchema),
            failedAt: isoTimestampSchema,
            reason: nonEmptyStringSchema,
            message: nonEmptyStringSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...commandProjectionBaseShape,
            status: Type.Literal('timed_out'),
            dispatchedAt: isoTimestampSchema,
            timedOutAt: isoTimestampSchema,
            reason: nonEmptyStringSchema,
        },
        { additionalProperties: false },
    ),
]);
export const recentCommandProjectionsSchema = Type.Array(terminalCommandProjectionSchema, {
    maxItems: 20,
});
export const roomSnapshotProjectionSchema = Type.Object(
    {
        roomName: nonEmptyStringSchema,
        updatedAt: isoTimestampSchema,
        devices: Type.Array(deviceProjectionSchema),
        activeCommands: Type.Array(activeCommandProjectionSchema),
        recentCommands: recentCommandProjectionsSchema,
    },
    { additionalProperties: false },
);

export type DeviceProjectionSchema = Static<typeof deviceProjectionSchema>;
