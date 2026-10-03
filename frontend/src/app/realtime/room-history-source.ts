import type { RoomHistoryRealtimeUpdate } from './room-realtime-client';

type Baseline = Extract<RoomHistoryRealtimeUpdate, { kind: 'baseline' }>;

export interface RoomHistorySource {
    subscribe(listener: (update: RoomHistoryRealtimeUpdate) => void): () => void;
    getBaseline(): Baseline | undefined;
    requestBaseline(): void;
}

/** Keeps only the current bounded baseline; additions are delivered synchronously. */
export function createRoomHistorySource() {
    let baseline: Baseline | undefined;
    let requestBaseline = () => undefined as void;
    const listeners = new Set<(update: RoomHistoryRealtimeUpdate) => void>();
    const source: RoomHistorySource = {
        subscribe(listener) {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        getBaseline: () => baseline,
        requestBaseline: () => requestBaseline(),
    };

    return {
        source,
        setRequestBaseline(action: () => void) {
            requestBaseline = action;
        },
        publish(update: RoomHistoryRealtimeUpdate, currentBaseline?: Baseline) {
            baseline = update.kind === 'interrupted' ? undefined : (currentBaseline ?? baseline);

            for (const listener of [...listeners]) {
                listener(update);
            }
        },
    };
}
