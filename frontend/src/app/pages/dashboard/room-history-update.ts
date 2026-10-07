import type { LiveTelemetrySampleProjection } from '@smart-room/contracts/history';
import type { RoomBffSnapshot } from '@smart-room/contracts/room-bff';
import type { UserHistoryItem } from '@smart-room/contracts/user-history';

export type RoomHistoryRealtimeUpdate =
    | { kind: 'interrupted' }
    | {
          kind: 'baseline';
          storage: RoomBffSnapshot['platform']['storage'];
          history: readonly UserHistoryItem[];
          /** Connection evidence retained when current storage metadata is unknown. */
          lastKnownHistoryGenerationId?: string | null;
      }
    | {
          kind: 'addition';
          storage: RoomBffSnapshot['platform']['storage'];
          history?: readonly UserHistoryItem[];
          telemetrySample?: LiveTelemetrySampleProjection;
      };
