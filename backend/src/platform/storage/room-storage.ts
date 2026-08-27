import type { RoomProjectionEvidence } from '../read-model/room-projection';

export interface StorageMetadata {
    historyGenerationId: string;
    schemaVersion: number;
    lastStorageSequence: number;
}

export type RecordDurability = 'durable' | 'volatile';

export interface AcceptedInputIdentity {
    eventId: string;
    fingerprint: string;
    durability: RecordDurability;
    acceptedAt: string;
}

export interface RoomStorageCheckpoint {
    updatedAt: string;
    projection: unknown;
    projectionEvidence: RoomProjectionEvidence;
    volatileGuards: AcceptedInputIdentity[];
}

export type StorageTransactionOutcome<Value> =
    | { status: 'committed'; value: Value }
    | { status: 'confirmed_rolled_back'; error: unknown }
    | { status: 'indeterminate'; error: unknown };

export interface RoomStorageTransaction {
    appendSignificantFact(input: SignificantFactInput): StoredSignificantFact;
    appendTelemetrySample(input: TelemetrySampleInput): StoredTelemetrySample;
    appendQuarantineEntry(input: QuarantineEntryInput): StoredQuarantineEntry;
    upsertAcceptedInputIdentity(input: AcceptedInputIdentity): void;
    retireExpiredRecords(input: { asOf: string }): string[];
    saveLatestRoomProjection(input: LatestRoomProjectionInput): void;
}

export interface SignificantFactInput {
    recordId: string;
    eventId?: string;
    eventType: string;
    deviceId?: string;
    commandId?: string;
    source?: string;
    occurredAt: string;
    payload: unknown;
}

export interface StoredSignificantFact extends SignificantFactInput {
    storageSequence: number;
}

export interface TelemetrySampleInput {
    recordId: string;
    eventId?: string;
    deviceId: string;
    metric: string;
    value: number;
    unit: string;
    occurredAt: string;
    payload: unknown;
}

export interface StoredTelemetrySample extends TelemetrySampleInput {
    storageSequence: number;
}

export interface QuarantineEntryInput {
    eventId?: string;
    reason: string;
    recordedAt: string;
    rawEvent: unknown;
}

export interface StoredQuarantineEntry extends QuarantineEntryInput {
    internalSequence: number;
}

export interface SimulatorCommandReceiptInput {
    source: string;
    commandId: string;
    updatedAt: string;
    receipt: unknown;
}

export type LatestRoomProjectionInput = RoomStorageCheckpoint;

export interface RoomStorage {
    getMetadata(): StorageMetadata;
    transact<Value>(
        operation: (transaction: RoomStorageTransaction) => Value,
    ): StorageTransactionOutcome<Value>;
    listAcceptedInputIdentities(): AcceptedInputIdentity[];
    isAcceptedInputIdentityActive(eventId: string, asOf: string): boolean;
    listSignificantFacts(): StoredSignificantFact[];
    listTelemetrySamples(query: {
        deviceId: string;
        metric: string;
        from?: string;
        to?: string;
    }): StoredTelemetrySample[];
    listQuarantineEntries(): StoredQuarantineEntry[];
    upsertSimulatorCommandReceipt(input: SimulatorCommandReceiptInput): void;
    getSimulatorCommandReceipt(
        source: string,
        commandId: string,
    ): SimulatorCommandReceiptInput | undefined;
    getLatestRoomProjection(): LatestRoomProjectionInput | undefined;
    close(): void;
}
