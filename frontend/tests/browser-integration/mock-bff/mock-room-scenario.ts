import type { RoomBffSnapshot } from '@smart-room/contracts/room-bff';
import type { RoomBffRealtimeServerMessage } from '@smart-room/contracts/room-bff';
import {
    compareUserHistoryDescending,
    type UserHistoryItem,
} from '@smart-room/contracts/user-history';

import { assertMockRoomSnapshot, assertMockSseMessage } from './mock-bff-contracts';
import { createOnlineLedRoomSnapshot } from './mock-bff-fixtures';

const historyLimit = 20;
type RoomSnapshotMessage = Extract<RoomBffRealtimeServerMessage, { messageType: 'room.snapshot' }>;

export class MockRoomScenario {
    #snapshot = createOnlineLedRoomSnapshot();
    #revision = 0;

    reset(): void {
        this.setSnapshot(createOnlineLedRoomSnapshot());
    }

    setSnapshot(snapshot: unknown): void {
        this.#snapshot = assertMockRoomSnapshot(snapshot);
        this.#revision = 0;
    }

    snapshotMessage(): RoomSnapshotMessage {
        return {
            messageType: 'room.snapshot',
            revision: 0,
            sentAt: this.#snapshot.updatedAt,
            payload: this.#snapshot,
        };
    }

    currentRevision(): number {
        return this.#revision;
    }

    applyUpdate(message: unknown): RoomBffRealtimeServerMessage {
        const update = assertMockSseMessage(message);

        if (update.messageType === 'room.snapshot') {
            throw new Error('Mock BFF realtime updates must not be room snapshots.');
        }

        if (update.previousRevision !== this.#revision) {
            throw new Error(
                `Mock BFF expected previous revision ${this.#revision}, received ${update.previousRevision}.`,
            );
        }

        const nextSnapshot = assertMockRoomSnapshot(applyUpdateToSnapshot(this.#snapshot, update));

        this.#snapshot = nextSnapshot;
        this.#revision = update.revision;

        return update;
    }
}

function applyUpdateToSnapshot(
    snapshot: RoomBffSnapshot,
    update: Exclude<RoomBffRealtimeServerMessage, { messageType: 'room.snapshot' }>,
): RoomBffSnapshot {
    if (update.messageType === 'platform.updated') {
        return {
            ...snapshot,
            updatedAt: update.sentAt,
            platform: { storage: update.payload.storage },
            userHistory:
                update.payload.storage.historyGenerationId !== null &&
                snapshot.platform.storage.historyGenerationId !== null &&
                update.payload.storage.historyGenerationId !==
                    snapshot.platform.storage.historyGenerationId
                    ? (update.payload.userHistory ?? [])
                    : mergeHistory(snapshot.userHistory, update.payload.userHistory),
        };
    }

    const devices =
        update.messageType === 'device.updated'
            ? replaceDevice(snapshot.devices, update.payload)
            : update.payload.devices;

    return {
        ...snapshot,
        updatedAt: update.sentAt,
        devices,
        userHistory: mergeHistory(
            snapshot.userHistory,
            update.messageType === 'device.updated'
                ? 'userHistory' in update
                    ? update.userHistory
                    : undefined
                : update.payload.userHistory,
        ),
        ...(update.messageType === 'commands.updated'
            ? {
                  activeCommands: update.payload.activeCommands,
                  recentCommands: update.payload.recentCommands,
              }
            : {}),
    };
}

function mergeHistory(
    current: UserHistoryItem[],
    updates: UserHistoryItem[] | undefined,
): UserHistoryItem[] {
    if (!updates || updates.length === 0) {
        return current;
    }

    const byRecordId = new Map(current.map((event) => [event.recordId, event]));

    for (const event of updates) {
        const previous = byRecordId.get(event.recordId);

        if (!previous || previous.durability !== 'durable' || event.durability === 'durable') {
            byRecordId.set(event.recordId, event);
        }
    }

    return [...byRecordId.values()].sort(compareUserHistoryDescending).slice(0, historyLimit);
}

function replaceDevice(
    devices: RoomBffSnapshot['devices'],
    updatedDevice: RoomBffSnapshot['devices'][number],
): RoomBffSnapshot['devices'] {
    if (!devices.some((device) => device.deviceId === updatedDevice.deviceId)) {
        throw new Error(`Mock BFF update references unknown device ${updatedDevice.deviceId}.`);
    }

    return devices.map((device) =>
        device.deviceId === updatedDevice.deviceId ? updatedDevice : device,
    );
}
