import type { HistoryLiveUpdate } from './history-live-update';

type Baseline = Extract<HistoryLiveUpdate, { kind: 'baseline' }>;

export interface HistoryLiveSource {
    subscribe(listener: (update: HistoryLiveUpdate) => void): () => void;
    getBaseline(): Baseline | undefined;
    requestBaseline(): void;
}
