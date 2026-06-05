import type { RealtimeClient, RoomSnapshotSubscriber } from './realtime-client';
import { roomFixtureSnapshot } from './room-fixture';

function cloneSnapshot() {
    return structuredClone(roomFixtureSnapshot);
}

export function createFixtureRealtimeClient(): RealtimeClient {
    const subscribers = new Set<RoomSnapshotSubscriber>();

    return {
        getInitialSnapshot() {
            return cloneSnapshot();
        },

        subscribe(subscriber) {
            subscribers.add(subscriber);
            return () => {
                subscribers.delete(subscriber);
            };
        },

        async sendCommand() {
            await Promise.resolve();
        },
    };
}
