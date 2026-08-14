export interface StorageMetadata {
    historyGenerationId: string;
    schemaVersion: number;
    lastStorageSequence: number;
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

export interface LatestRoomProjectionInput {
    updatedAt: string;
    projection: unknown;
}

export interface RoomStorage {
    getMetadata(): StorageMetadata;
    appendSignificantFact(input: SignificantFactInput): StoredSignificantFact;
    listSignificantFacts(): StoredSignificantFact[];
    appendTelemetrySample(input: TelemetrySampleInput): StoredTelemetrySample;
    listTelemetrySamples(query: {
        deviceId: string;
        metric: string;
        from?: string;
        to?: string;
    }): StoredTelemetrySample[];
    appendQuarantineEntry(input: QuarantineEntryInput): StoredQuarantineEntry;
    listQuarantineEntries(): StoredQuarantineEntry[];
    upsertSimulatorCommandReceipt(input: SimulatorCommandReceiptInput): void;
    getSimulatorCommandReceipt(
        source: string,
        commandId: string,
    ): SimulatorCommandReceiptInput | undefined;
    saveLatestRoomProjection(input: LatestRoomProjectionInput): void;
    getLatestRoomProjection(): LatestRoomProjectionInput | undefined;
    close(): void;
}
