import type { RoomHistoryRealtimeUpdate } from './room-history-update';

type Baseline = Extract<RoomHistoryRealtimeUpdate, { kind: 'baseline' }>;

export interface RoomHistorySource {
    subscribe(listener: (update: RoomHistoryRealtimeUpdate) => void): () => void;
    getBaseline(): Baseline | undefined;
    requestBaseline(): void;
}
