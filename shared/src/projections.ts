import { type Static, Type } from '@sinclair/typebox';

import type { ActiveCommandProjection, TerminalCommandProjection } from './commands';
import { commandDeliveryEvidenceSchema, powerStateProjectionSchema } from './commands';
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
import type { RecentEventProjection } from './history';
import { recentEventsProjectionSchema } from './history';
import {
    commandDurabilitySchema,
    type EvidenceDurability,
    evidenceDurabilitySchema,
    historyGenerationIdSchema,
    storedThroughSequenceSchema,
} from './storage';
import { isoTimestampSchema, nonEmptyStringSchema } from './validation';

export interface DeviceProjection {
    deviceId: string;
    name: string;
    role: DeviceRole;
    availability: DeviceAvailability;
    availabilityChangedAt: string;
    availabilityDurability: EvidenceDurability;
    availabilityReason?: string;
    health: DeviceOperationalHealth;
    healthChangedAt: string;
    healthDurability: EvidenceDurability;
    healthReason?: string;
    reportedState: DeviceState;
    observationStatus: Record<
        string,
        { freshness: ObservationFreshness; lastObservedAt?: string; durability: EvidenceDurability }
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
    recentEvents: RecentEventProjection[];
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
            durability: evidenceDurabilitySchema,
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
        availabilityDurability: evidenceDurabilitySchema,
        availabilityReason: Type.Optional(nonEmptyStringSchema),
        health: Type.Union(deviceOperationalHealthStates.map((value) => Type.Literal(value))),
        healthChangedAt: isoTimestampSchema,
        healthDurability: evidenceDurabilitySchema,
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
    durability: commandDurabilitySchema,
    lifecycleDurability: commandDurabilitySchema,
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
            historyGenerationId: historyGenerationIdSchema,
            storedThroughSequence: storedThroughSequenceSchema,
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
            historyGenerationId: historyGenerationIdSchema,
            storedThroughSequence: storedThroughSequenceSchema,
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
        recentEvents: recentEventsProjectionSchema,
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
