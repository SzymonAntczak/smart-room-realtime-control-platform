import type {
    LiveTelemetrySampleProjection,
    RecentEventProjection,
} from '@smart-room/contracts/history';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type { RoomPublicationBatch } from '@smart-room/contracts/realtime';

import { buildPublicationDeltas, sameJson } from './room-publication-policy';

export type RoomSnapshotListener = (snapshot: RoomSnapshotProjection) => void;
export type RoomPublicationBatchListener = (batch: RoomPublicationBatch) => void;

export interface RoomPublication {
    subscribeRoomSnapshot(listener: RoomSnapshotListener): () => void;
    subscribeRoomPublicationBatch(listener: RoomPublicationBatchListener): () => void;
    lastPublishedSnapshot(): RoomSnapshotProjection | undefined;
    notify(
        evaluatedAt: string,
        installedProjectionOnly?: boolean,
        platformBeforeOutcome?: boolean,
        relatedRecentEvents?: readonly RecentEventProjection[],
        telemetrySample?: LiveTelemetrySampleProjection,
    ): void;
    publish(snapshot: RoomSnapshotProjection, deltas: RoomPublicationBatch['deltas']): void;
    stageRecoveryGap(event: RecentEventProjection): void;
    publishRecoveryCommit(): void;
}

/** Owns the publication baseline and freezes both subscriber groups per batch. */
export function createRoomPublication({
    snapshotAt,
    installedSnapshot,
}: {
    snapshotAt(evaluatedAt: string): RoomSnapshotProjection;
    installedSnapshot(): RoomSnapshotProjection;
}): RoomPublication {
    const snapshotListeners = new Set<RoomSnapshotListener>();
    const batchListeners = new Set<RoomPublicationBatchListener>();
    let baseline: RoomSnapshotProjection | undefined;
    let stagedRecoveryGap: RecentEventProjection | undefined;

    function publish(
        snapshot: RoomSnapshotProjection,
        deltas: RoomPublicationBatch['deltas'],
    ): void {
        baseline = snapshot;
        // Capture both audiences before the first callback. Reentrant
        // subscribers observe the new baseline but join only the next batch.
        const snapshotAudience = [...snapshotListeners];
        const batchAudience = [...batchListeners];

        for (const listener of snapshotAudience) {
            try {
                listener(snapshot);
            } catch {
                // One failed client must not block other clients or ingestion.
            }
        }

        for (const listener of batchAudience) {
            try {
                listener({ snapshot, deltas });
            } catch {
                // One failed client must not block other clients or ingestion.
            }
        }
    }

    return {
        subscribeRoomSnapshot(listener) {
            snapshotListeners.add(listener);

            return () => snapshotListeners.delete(listener);
        },
        subscribeRoomPublicationBatch(listener) {
            batchListeners.add(listener);

            return () => batchListeners.delete(listener);
        },
        lastPublishedSnapshot() {
            return baseline;
        },
        notify(
            evaluatedAt,
            installedProjectionOnly = false,
            platformBeforeOutcome = false,
            relatedRecentEvents = [],
            telemetrySample,
        ) {
            const snapshot = installedProjectionOnly
                ? installedSnapshot()
                : snapshotAt(evaluatedAt);

            publish(
                snapshot,
                buildPublicationDeltas(
                    baseline,
                    snapshot,
                    platformBeforeOutcome,
                    relatedRecentEvents,
                    telemetrySample,
                ),
            );
        },
        publish(snapshot, deltas) {
            publish(snapshot, deltas);
        },
        stageRecoveryGap(event) {
            stagedRecoveryGap = event;
        },
        publishRecoveryCommit() {
            const snapshot = installedSnapshot();
            const previous = baseline;
            const committedGap = stagedRecoveryGap;
            const nonGapEvents = snapshot.recentEvents.filter(
                (event) => event.eventType !== 'storage.gap.recorded',
            );
            const reconciliationRequired =
                previous === undefined ||
                !sameJson(previous.devices, snapshot.devices) ||
                !sameJson(previous.activeCommands, snapshot.activeCommands) ||
                !sameJson(previous.recentCommands, snapshot.recentCommands) ||
                !sameJson(
                    previous.recentEvents.filter(
                        (event) => event.eventType !== 'storage.gap.recorded',
                    ),
                    nonGapEvents,
                );

            publish(snapshot, [
                ...(reconciliationRequired
                    ? [
                          {
                              messageType: 'commands.updated' as const,
                              payload: {
                                  devices: snapshot.devices,
                                  activeCommands: snapshot.activeCommands,
                                  recentCommands: snapshot.recentCommands,
                                  recentEvents: nonGapEvents,
                              },
                          },
                      ]
                    : []),
                {
                    messageType: 'platform.updated',
                    payload: {
                        storage: snapshot.platform.storage,
                        recentEvents: committedGap ? [committedGap] : [],
                    },
                },
            ]);
            stagedRecoveryGap = undefined;
        },
    };
}
