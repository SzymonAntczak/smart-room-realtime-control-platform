import type { HistoryDevice } from '../history-context';

export interface HistoryFeedContext {
    devices: readonly HistoryDevice[];
    endReached: boolean;
    totalItems: number;
}
