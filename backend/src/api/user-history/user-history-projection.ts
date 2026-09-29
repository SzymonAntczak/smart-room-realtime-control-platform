import type { TerminalCommandProjection } from '@smart-room/contracts/commands';
import type { RecentEventProjection } from '@smart-room/contracts/history';
import { recentEventsLimit } from '@smart-room/contracts/history';
import {
    type DeviceProjection,
    type RoomSnapshotProjection,
} from '@smart-room/contracts/projections';
import {
    isRoomRealtimeServerMessage,
    isRoomSnapshotProjection,
    type RoomPublicationBatch,
} from '@smart-room/contracts/realtime';
import {
    isRoomBffRealtimeServerMessage,
    isRoomBffSnapshot,
    type RoomBffRealtimeServerMessage,
    type RoomBffSnapshot,
} from '@smart-room/contracts/room-bff';
import {
    compareUserHistoryDescending,
    isUserHistoryItem,
    type UserHistoryItem,
} from '@smart-room/contracts/user-history';

type RoomBffPublicationDelta =
    Exclude<RoomBffRealtimeServerMessage, { messageType: 'room.snapshot' }> extends infer Message
        ? Message extends { previousRevision: number; revision: number; sentAt: string }
            ? Omit<Message, 'previousRevision' | 'revision' | 'sentAt'>
            : never
        : never;

function isPowerState(value: unknown): value is 'on' | 'off' {
    return value === 'on' || value === 'off';
}

/** Converts the bounded technical cache to only the entries it can prove. */
export function toRoomBffSnapshot(snapshot: RoomSnapshotProjection): RoomBffSnapshot {
    assertRoomSnapshot(snapshot, 'snapshot');

    const userHistory = collectItems(
        snapshot.recentEvents.flatMap((event) => {
            if (
                event.eventType === 'device.state.reported' ||
                event.eventType === 'device.availability.changed' ||
                event.eventType === 'device.health.changed'
            ) {
                return [];
            }

            return transformNonDeviceChange(event, snapshot, snapshot.recentEvents);
        }),
    );
    const projection = omitRecentEvents(snapshot);
    const result = { ...projection, userHistory };

    if (!isRoomBffSnapshot(result)) {
        throw new Error('BFF user-history snapshot failed shared contract validation.');
    }

    return result;
}

/** Transforms one atomic platform batch without changing its delta boundaries. */
export function toRoomBffPublicationDeltas(
    previousSnapshot: RoomSnapshotProjection,
    batch: RoomPublicationBatch,
): RoomBffPublicationDelta[] {
    assertRoomSnapshot(previousSnapshot, 'previous snapshot');
    assertRoomSnapshot(batch.snapshot, 'publication snapshot');

    if (!sameDeviceSet(previousSnapshot, batch.snapshot)) {
        throw new Error('A publication batch cannot change the configured room device set.');
    }

    const rawMessages = batch.deltas.map((delta, index) => {
        const revision = index + 1;
        const message = {
            ...delta,
            previousRevision: revision - 1,
            revision,
            sentAt: batch.snapshot.updatedAt,
        };

        if (!isRoomRealtimeServerMessage(message)) {
            throw new Error(`Invalid source publication delta at index ${index}.`);
        }

        return message;
    });
    const hasRecoveryGap =
        batch.snapshot.platform.storage.status === 'available' &&
        rawMessages.some(
            (message) =>
                message.messageType === 'platform.updated' &&
                message.payload.recentEvents?.some(
                    (event) => event.eventType === 'storage.gap.recorded',
                ),
        );
    const allBatchEvents = rawMessages.flatMap((message) =>
        message.messageType === 'device.updated'
            ? (message.recentEvents ?? [])
            : (message.payload.recentEvents ?? []),
    );
    const transformed = rawMessages.map((message): RoomBffPublicationDelta => {
        switch (message.messageType) {
            case 'device.updated': {
                const events = message.recentEvents ?? [];
                const userHistory = collectItems(
                    classifyLiveEvents(
                        events,
                        allBatchEvents,
                        previousSnapshot,
                        batch.snapshot,
                        hasRecoveryGap,
                    ),
                );
                const delta = omitTransportEnvelope(omitRecentEvents(message));

                return { ...delta, ...(userHistory.length > 0 ? { userHistory } : {}) };
            }

            case 'commands.updated': {
                const events = message.payload.recentEvents ?? [];
                const userHistory = collectItems(
                    classifyLiveEvents(
                        events,
                        allBatchEvents,
                        previousSnapshot,
                        batch.snapshot,
                        hasRecoveryGap,
                    ),
                );
                const payload = omitRecentEvents(message.payload);

                return {
                    messageType: message.messageType,
                    payload: { ...payload, ...(userHistory.length > 0 ? { userHistory } : {}) },
                };
            }

            case 'platform.updated': {
                const events = message.payload.recentEvents ?? [];
                const userHistory = collectItems(
                    events.flatMap((event) =>
                        transformNonDeviceChange(event, batch.snapshot, events),
                    ),
                );
                const payload = omitRecentEvents(message.payload);

                return {
                    messageType: message.messageType,
                    payload: { ...payload, ...(userHistory.length > 0 ? { userHistory } : {}) },
                };
            }
        }
    });

    let previousRevision = 0;

    for (const [index, delta] of transformed.entries()) {
        const message = {
            ...delta,
            previousRevision,
            revision: previousRevision + 1,
            sentAt: batch.snapshot.updatedAt,
        };

        if (!isRoomBffRealtimeServerMessage(message)) {
            throw new Error(
                `BFF user-history delta failed shared contract validation at index ${index}.`,
            );
        }

        previousRevision += 1;
    }

    return transformed;
}

function assertRoomSnapshot(
    value: unknown,
    description: string,
): asserts value is RoomSnapshotProjection {
    if (!isRoomSnapshotProjection(value)) {
        throw new Error(`Invalid ${description} supplied to the BFF user-history transformer.`);
    }
}

function sameDeviceSet(left: RoomSnapshotProjection, right: RoomSnapshotProjection): boolean {
    if (left.devices.length !== right.devices.length) {
        return false;
    }

    const leftIds = new Set(left.devices.map((device) => device.deviceId));

    return right.devices.every((device) => leftIds.has(device.deviceId));
}

function omitRecentEvents<T extends { recentEvents?: unknown }>(value: T): Omit<T, 'recentEvents'> {
    const copy = { ...value };
    delete copy.recentEvents;

    return copy;
}

function omitTransportEnvelope<
    T extends { previousRevision: number; revision: number; sentAt: string },
>(value: T): Omit<T, 'previousRevision' | 'revision' | 'sentAt'> {
    const { previousRevision, revision, sentAt, ...delta } = value;

    if (revision !== previousRevision + 1 || sentAt.length === 0) {
        throw new Error('Invalid transport envelope in a source publication delta.');
    }

    return delta;
}

function classifyLiveEvents(
    events: readonly RecentEventProjection[],
    allBatchEvents: readonly RecentEventProjection[],
    previousSnapshot: RoomSnapshotProjection,
    nextSnapshot: RoomSnapshotProjection,
    hasRecoveryGap: boolean,
): UserHistoryItem[] {
    const previousRecordIds = new Set(previousSnapshot.recentEvents.map((event) => event.recordId));
    const nextDevices = new Map(nextSnapshot.devices.map((device) => [device.deviceId, device]));
    const previousDevices = new Map(
        previousSnapshot.devices.map((device) => [device.deviceId, device]),
    );

    return events.flatMap((event) => {
        if (event.eventType === 'device.state.reported') {
            if (previousRecordIds.has(event.recordId) || hasRecoveryGap) {
                return [];
            }

            const current = nextDevices.get(event.deviceId);

            if (!current || !hasUniqueAppliedDeviceFact(event, allBatchEvents, current)) {
                return [];
            }

            return transformAppliedDeviceChange(
                event,
                previousDevices.get(event.deviceId),
                nextDevices.get(event.deviceId),
            );
        }

        if (
            event.eventType === 'device.availability.changed' ||
            event.eventType === 'device.health.changed'
        ) {
            if (previousRecordIds.has(event.recordId) || hasRecoveryGap) {
                return [];
            }

            const current = nextDevices.get(event.deviceId);

            if (!current || !hasUniqueAppliedDeviceFact(event, allBatchEvents, current)) {
                return [];
            }

            return transformAppliedDeviceChange(
                event,
                previousDevices.get(event.deviceId),
                nextDevices.get(event.deviceId),
            );
        }

        return transformNonDeviceChange(event, nextSnapshot, [
            ...previousSnapshot.recentEvents,
            ...events,
        ]);
    });
}

function hasUniqueAppliedDeviceFact(
    event: Extract<RecentEventProjection, { deviceId: string }>,
    events: readonly RecentEventProjection[],
    current: DeviceProjection,
): boolean {
    const matches = events.filter((candidate) => {
        if (
            candidate.eventType !== event.eventType ||
            !('deviceId' in candidate) ||
            candidate.deviceId !== event.deviceId ||
            candidate.occurredAt !== event.occurredAt
        ) {
            return false;
        }

        switch (event.eventType) {
            case 'device.state.reported':
                return (
                    candidate.eventType === 'device.state.reported' &&
                    current.observationStatus.power?.lastObservedAt === event.occurredAt &&
                    isPowerState(current.reportedState.power) &&
                    candidate.payload.reportedState.power === current.reportedState.power
                );
            case 'device.availability.changed':
                return (
                    candidate.eventType === 'device.availability.changed' &&
                    current.availabilityChangedAt === event.occurredAt &&
                    candidate.payload.availability === current.availability
                );
            case 'device.health.changed':
                return (
                    candidate.eventType === 'device.health.changed' &&
                    current.healthChangedAt === event.occurredAt &&
                    candidate.payload.health === current.health
                );
            default:
                return false;
        }
    });

    return matches.length === 1 && matches[0]?.recordId === event.recordId;
}

function transformAppliedDeviceChange(
    event: Extract<RecentEventProjection, { deviceId: string }>,
    previous: DeviceProjection | undefined,
    current: DeviceProjection | undefined,
): UserHistoryItem[] {
    if (!current) {
        return [];
    }

    const common = {
        recordId: event.recordId,
        occurredAt: event.occurredAt,
        source: event.source,
        deviceId: current.deviceId,
        deviceName: current.name,
    };

    switch (event.eventType) {
        case 'device.state.reported': {
            const observedAt = current.observationStatus.power?.lastObservedAt;
            const nextPower = current.reportedState.power;
            const priorPower = previous?.reportedState.power;

            if (
                observedAt !== event.occurredAt ||
                !isPowerState(nextPower) ||
                event.payload.reportedState.power !== nextPower ||
                (isPowerState(priorPower) && priorPower === nextPower)
            ) {
                return [];
            }

            return [
                itemFromEvent(event, {
                    ...common,
                    kind: 'power_changed',
                    previous: isPowerState(priorPower) ? priorPower : null,
                    current: nextPower,
                }),
            ];
        }

        case 'device.availability.changed': {
            if (
                current.availabilityChangedAt !== event.occurredAt ||
                current.availability !== event.payload.availability ||
                previous?.availability === current.availability
            ) {
                return [];
            }

            return [
                itemFromEvent(event, {
                    ...common,
                    kind: 'availability_changed',
                    previous: previous?.availability ?? null,
                    current: current.availability,
                }),
            ];
        }

        case 'device.health.changed': {
            if (
                current.healthChangedAt !== event.occurredAt ||
                current.health !== event.payload.health ||
                previous?.health === current.health
            ) {
                return [];
            }

            return [
                itemFromEvent(event, {
                    ...common,
                    kind: 'health_changed',
                    previous: previous?.health ?? null,
                    current: current.health,
                }),
            ];
        }

        default:
            return [];
    }
}

function transformNonDeviceChange(
    event: RecentEventProjection,
    snapshot: RoomSnapshotProjection,
    evidence: readonly RecentEventProjection[],
): UserHistoryItem[] {
    if (event.eventType === 'storage.gap.recorded') {
        return [
            itemFromEvent(event, {
                recordId: event.recordId,
                occurredAt: event.occurredAt,
                source: 'backend',
                kind: 'history_gap',
                outageStartedAt: event.payload.outageStartedAt,
                outageEndedAt: event.payload.outageEndedAt,
            }),
        ];
    }

    if (event.eventType === 'command.failed') {
        const device = snapshot.devices.find((candidate) => candidate.deviceId === event.deviceId);

        if (!device) {
            return [];
        }

        const requestedPower = knownFailedPower(event, snapshot.recentCommands);
        const item = itemFromEvent(event, {
            recordId: event.recordId,
            occurredAt: event.occurredAt,
            source: event.source,
            deviceId: event.deviceId,
            deviceName: device.name,
            kind: 'attempt_failed',
            ...(requestedPower ? { requestedPower } : {}),
        });

        return [item];
    }

    if (event.eventType === 'command.timed_out') {
        const device = snapshot.devices.find((candidate) => candidate.deviceId === event.deviceId);
        const requestedPower = knownTimedOutPower(event, snapshot.recentCommands, evidence);

        if (!device || !requestedPower) {
            return [];
        }

        return [
            itemFromEvent(event, {
                recordId: event.recordId,
                occurredAt: event.occurredAt,
                source: event.source,
                deviceId: event.deviceId,
                deviceName: device.name,
                kind: 'confirmation_missing',
                requestedPower,
            }),
        ];
    }

    return [];
}

function itemFromEvent(
    event: RecentEventProjection,
    fields: Record<string, unknown>,
): UserHistoryItem {
    const value = {
        ...fields,
        durability: event.durability,
        ...('storageSequence' in event ? { storageSequence: event.storageSequence } : {}),
    };

    if (!isUserHistoryItem(value)) {
        throw new Error(
            `Transformed record ${event.recordId} failed the user-history item contract.`,
        );
    }

    return value;
}

function knownFailedPower(
    event: Extract<RecentEventProjection, { eventType: 'command.failed' }>,
    commands: readonly TerminalCommandProjection[],
): 'on' | 'off' | undefined {
    const fromFact =
        event.payload.commandType === 'set.power' ? event.payload.requestedState?.power : undefined;
    const fromCommand = matchingCommand(event, commands, 'failed')?.requestedState.power;

    if (fromFact && fromCommand && fromFact !== fromCommand) {
        return undefined;
    }

    return fromFact ?? fromCommand;
}

function knownTimedOutPower(
    event: Extract<RecentEventProjection, { eventType: 'command.timed_out' }>,
    commands: readonly TerminalCommandProjection[],
    evidence: readonly RecentEventProjection[],
): 'on' | 'off' | undefined {
    const fromCommand = matchingCommand(event, commands, 'timed_out')?.requestedState.power;
    const requests = evidence.filter(
        (candidate) =>
            candidate.eventType === 'command.requested' &&
            candidate.commandId === event.commandId &&
            candidate.deviceId === event.deviceId,
    );
    const requestPowers = requests.flatMap((request) =>
        request.eventType === 'command.requested' && request.payload.commandType === 'set.power'
            ? [request.payload.requestedState.power]
            : [],
    );
    const uniqueRequestPowers = new Set(requestPowers);

    if (uniqueRequestPowers.size > 1) {
        return undefined;
    }

    const fromRequest = requestPowers[0];

    if (fromCommand && fromRequest && fromCommand !== fromRequest) {
        return undefined;
    }

    return fromCommand ?? fromRequest;
}

function matchingCommand(
    event: Extract<RecentEventProjection, { commandId: string }>,
    commands: readonly TerminalCommandProjection[],
    status: TerminalCommandProjection['status'],
): TerminalCommandProjection | undefined {
    const command = commands.find(
        (candidate) =>
            candidate.commandId === event.commandId &&
            candidate.deviceId === event.deviceId &&
            candidate.status === status,
    );

    return command;
}

function collectItems(items: readonly UserHistoryItem[]): UserHistoryItem[] {
    const byRecordId = new Map<string, UserHistoryItem>();

    for (const item of items) {
        const existing = byRecordId.get(item.recordId);

        if (!existing) {
            byRecordId.set(item.recordId, item);
            continue;
        }

        const existingIsDurable = existing.durability === 'durable';
        const itemIsDurable = item.durability === 'durable';

        if (existingIsDurable && !itemIsDurable) {
            continue;
        }

        if (itemIsDurable && !existingIsDurable) {
            byRecordId.set(item.recordId, item);
            continue;
        }

        if (JSON.stringify(existing) !== JSON.stringify(item)) {
            throw new Error(`Conflicting user-history entries share recordId ${item.recordId}.`);
        }
    }

    return [...byRecordId.values()].sort(compareUserHistoryDescending).slice(0, recentEventsLimit);
}
