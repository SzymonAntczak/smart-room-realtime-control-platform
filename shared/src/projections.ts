import { type Static, Type } from '@sinclair/typebox';

import type { ActiveCommandProjection, Durability, TerminalCommandProjection } from './commands';
import { durabilityValues, powerStateProjectionSchema } from './commands';
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
    availabilityDurability: Durability;
    availabilityReason?: string;
    health: DeviceOperationalHealth;
    healthChangedAt: string;
    healthDurability: Durability;
    healthReason?: string;
    reportedState: DeviceState;
    observationStatus: Record<
        string,
        { freshness: ObservationFreshness; lastObservedAt?: string; durability: Durability }
    >;
    commandAvailability: CommandAvailability;
    activeCommandId?: string;
}
export type PlatformStorageProjection =
    | {
          status: 'available';
          changedAt: string;
          historyGenerationId: string;
          storedThroughSequence: number;
      }
    | {
          status: 'degraded' | 'recovering';
          changedAt: string;
          reason: string;
          historyGenerationId: null;
          storedThroughSequence: null;
      }
    | {
          status: 'degraded' | 'recovering';
          changedAt: string;
          reason: string;
          historyGenerationId: string;
          storedThroughSequence: number;
      };
export interface RoomSnapshotProjection {
    roomName: string;
    updatedAt: string;
    devices: DeviceProjection[];
    activeCommands: ActiveCommandProjection[];
    recentCommands: TerminalCommandProjection[];
    platform: { storage: PlatformStorageProjection };
}

const deviceStateSchema = Type.Record(
    Type.String(),
    Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
);
const commandAvailabilitySchema = Type.Object(
    {
        policy: Type.Union(commandAvailabilityPolicies.map((policy) => Type.Literal(policy))),
        reason: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);
const observationStatusSchema = Type.Record(
    Type.String(),
    Type.Object(
        {
            freshness: Type.Union(observationFreshnessStates.map((value) => Type.Literal(value))),
            lastObservedAt: Type.Optional(isoTimestampSchema),
            durability: Type.Union(durabilityValues.map((value) => Type.Literal(value))),
        },
        { additionalProperties: false },
    ),
);
export const deviceProjectionSchema = Type.Object(
    {
        deviceId: nonEmptyStringSchema,
        name: nonEmptyStringSchema,
        role: Type.Union(deviceRoles.map((role) => Type.Literal(role))),
        availability: Type.Union(deviceAvailabilityStates.map((value) => Type.Literal(value))),
        availabilityChangedAt: isoTimestampSchema,
        availabilityDurability: Type.Union(durabilityValues.map((value) => Type.Literal(value))),
        availabilityReason: Type.Optional(nonEmptyStringSchema),
        health: Type.Union(deviceOperationalHealthStates.map((value) => Type.Literal(value))),
        healthChangedAt: isoTimestampSchema,
        healthDurability: Type.Union(durabilityValues.map((value) => Type.Literal(value))),
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
    durability: Type.Union(durabilityValues.map((value) => Type.Literal(value))),
    lifecycleDurability: Type.Union(durabilityValues.map((value) => Type.Literal(value))),
};
const commandDeliveryEvidenceSchema = Type.Union([
    Type.Object(
        {
            status: Type.Literal('handed_off'),
            dispatchedAt: isoTimestampSchema,
            deadlineAt: isoTimestampSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            status: Type.Literal('uncertain'),
            firstAttemptedAt: isoTimestampSchema,
            deadlineAt: isoTimestampSchema,
        },
        { additionalProperties: false },
    ),
]);
export const activeCommandProjectionSchema = Type.Union([
    Type.Object(
        { ...commandProjectionBaseShape, status: Type.Literal('accepted') },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...commandProjectionBaseShape,
            status: Type.Literal('pending'),
            delivery: commandDeliveryEvidenceSchema,
        },
        { additionalProperties: false },
    ),
]);
export const terminalCommandProjectionSchema = Type.Union([
    Type.Object(
        {
            ...commandProjectionBaseShape,
            status: Type.Literal('confirmed'),
            delivery: commandDeliveryEvidenceSchema,
            confirmedAt: isoTimestampSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...commandProjectionBaseShape,
            status: Type.Literal('failed'),
            delivery: Type.Optional(commandDeliveryEvidenceSchema),
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
            delivery: commandDeliveryEvidenceSchema,
            timedOutAt: isoTimestampSchema,
            reason: nonEmptyStringSchema,
        },
        { additionalProperties: false },
    ),
]);
export const recentCommandProjectionsSchema = Type.Array(terminalCommandProjectionSchema, {
    maxItems: 20,
});
export const platformStorageProjectionSchema = Type.Union([
    Type.Object(
        {
            status: Type.Literal('available'),
            changedAt: isoTimestampSchema,
            historyGenerationId: nonEmptyStringSchema,
            storedThroughSequence: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            status: Type.Union([Type.Literal('degraded'), Type.Literal('recovering')]),
            changedAt: isoTimestampSchema,
            reason: nonEmptyStringSchema,
            historyGenerationId: Type.Null(),
            storedThroughSequence: Type.Null(),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            status: Type.Union([Type.Literal('degraded'), Type.Literal('recovering')]),
            changedAt: isoTimestampSchema,
            reason: nonEmptyStringSchema,
            historyGenerationId: nonEmptyStringSchema,
            storedThroughSequence: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
    ),
]);
export const roomSnapshotProjectionSchema = Type.Object(
    {
        roomName: nonEmptyStringSchema,
        updatedAt: isoTimestampSchema,
        devices: Type.Array(deviceProjectionSchema),
        activeCommands: Type.Array(activeCommandProjectionSchema),
        recentCommands: recentCommandProjectionsSchema,
        platform: Type.Object(
            {
                storage: platformStorageProjectionSchema,
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);

export type DeviceProjectionSchema = Static<typeof deviceProjectionSchema>;
