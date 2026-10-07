import type { RenderableDeviceProjection } from '../../../device-projection';

export interface HistoryFeedContext {
    devices: readonly RenderableDeviceProjection[];
    endReached: boolean;
    totalItems: number;
}
