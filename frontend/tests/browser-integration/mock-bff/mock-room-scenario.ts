import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type {
    RoomRealtimeServerMessage,
    RoomSnapshotMessage,
} from '@smart-room/contracts/realtime';

import { assertMockRoomSnapshot, assertMockSseMessage } from './mock-bff-contracts';
import { createOnlineLedRoomSnapshot } from './mock-bff-fixtures';

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

    applyUpdate(message: unknown): RoomRealtimeServerMessage {
        const update = assertMockSseMessage(message);

        if (update.messageType === 'room.snapshot') {
            throw new Error('Mock BFF realtime updates must not be room snapshots.');
        }

        if (update.previousRevision !== this.#revision) {
            throw new Error(
                `Mock BFF expected previous revision ${this.#revision}, received ${update.previousRevision}.`,
            );
        }

        const nextSnapshot = applyUpdateToSnapshot(this.#snapshot, update);

        this.#snapshot = nextSnapshot;
        this.#revision = update.revision;

        return update;
    }
}

function applyUpdateToSnapshot(
    snapshot: RoomSnapshotProjection,
    update: Exclude<RoomRealtimeServerMessage, { messageType: 'room.snapshot' }>,
): RoomSnapshotProjection {
    if (update.messageType === 'platform.updated') {
        return {
            ...snapshot,
            updatedAt: update.sentAt,
            platform: update.payload,
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
        ...(update.messageType === 'commands.updated'
            ? {
                  activeCommands: update.payload.activeCommands,
                  recentCommands: update.payload.recentCommands,
              }
            : {}),
    };
}

function replaceDevice(
    devices: RoomSnapshotProjection['devices'],
    updatedDevice: RoomSnapshotProjection['devices'][number],
): RoomSnapshotProjection['devices'] {
    if (!devices.some((device) => device.deviceId === updatedDevice.deviceId)) {
        throw new Error(`Mock BFF update references unknown device ${updatedDevice.deviceId}.`);
    }

    return devices.map((device) =>
        device.deviceId === updatedDevice.deviceId ? updatedDevice : device,
    );
}
