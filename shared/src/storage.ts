import { type Static, Type } from '@sinclair/typebox';

import { nonEmptyStringSchema } from './validation';

export const durabilityValues = ['durable', 'volatile'] as const;

export const recordDurabilitySchema = Type.Union(
    durabilityValues.map((value) => Type.Literal(value)),
);
export type RecordDurability = Static<typeof recordDurabilitySchema>;

/** Semantic alias used where durability describes a command admission or lifecycle. */
export const commandDurabilitySchema = recordDurabilitySchema;
export type CommandDurability = RecordDurability;

/** Semantic alias used where durability describes one dimension of device evidence. */
export const evidenceDurabilitySchema = recordDurabilitySchema;
export type EvidenceDurability = RecordDurability;

/** Opaque, versioned logical identity shared by history, feed and realtime views. */
export const recordIdSchema = Type.String({ pattern: '^rec:v1:sha256:[a-f0-9]{64}$' });
export type RecordId = Static<typeof recordIdSchema>;

/** Opaque ID for one physical history database lifetime. */
export const historyGenerationIdSchema = nonEmptyStringSchema;
export type HistoryGenerationId = Static<typeof historyGenerationIdSchema>;

/** Sequence assigned to one persisted fact or telemetry row in its generation. */
export const storageSequenceSchema = Type.Integer({ minimum: 1 });
export type StorageSequence = Static<typeof storageSequenceSchema>;

/** Durable history watermark; an empty valid generation is represented by zero. */
export const storedThroughSequenceSchema = Type.Integer({ minimum: 0 });
export type StoredThroughSequence = Static<typeof storedThroughSequenceSchema>;
