import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type { RoomRealtimeServerMessage } from '@smart-room/contracts/realtime';

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

    snapshotMessage(): RoomRealtimeServerMessage {
        return {
            messageType: 'room.snapshot',
            revision: 0,
            sentAt: this.#snapshot.updatedAt,
            payload: this.#snapshot,
        };
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
    const device = update.messageType === 'device.updated' ? update.payload : update.payload.device;
    const devices = snapshot.devices.map((currentDevice) =>
        currentDevice.deviceId === device.deviceId ? device : currentDevice,
    );

    if (!snapshot.devices.some((currentDevice) => currentDevice.deviceId === device.deviceId)) {
        throw new Error(`Mock BFF update references unknown device ${device.deviceId}.`);
    }

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
