import { type RoomSnapshotProjection } from '@smart-room/contracts/projections';
import {
    isRoomSnapshotProjection,
    type RoomPublicationBatch,
} from '@smart-room/contracts/realtime';
import {
    isRoomBffRealtimeServerMessage,
    type RoomBffRealtimeServerMessage,
} from '@smart-room/contracts/room-bff';
import { normalizeIsoTimestamp } from '@smart-room/contracts/validation';
import type { FastifyReply } from 'fastify';

import {
    toRoomBffPublicationDeltas,
    toRoomBffSnapshot,
} from './user-history/user-history-projection';

interface RoomRealtimeStreamConfig {
    getRoomSnapshot(): RoomSnapshotProjection;
    subscribeRoomPublicationBatch(listener: (batch: RoomPublicationBatch) => void): () => void;
    now(): string;
}

export interface RoomRealtimeWritable {
    readonly destroyed: boolean;
    readonly writableEnded: boolean;
    end(): void;
    once(event: 'close' | 'drain' | 'error', listener: () => void): this;
    removeListener(event: 'drain', listener: () => void): this;
    write(chunk: string): boolean;
}

interface PublicationBatch {
    readonly frames: readonly string[];
    readonly nextRevision: number;
}

type BatchBuildResult =
    | { readonly kind: 'empty' }
    | { readonly kind: 'invalid' }
    | { readonly kind: 'ready'; readonly batch: PublicationBatch };

export function startRoomRealtimeStream(
    response: FastifyReply,
    config: RoomRealtimeStreamConfig,
): void {
    response.hijack();
    const stream = response.raw;
    stream.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
    });
    stream.flushHeaders();

    startRoomRealtimePublisher(stream, config);
}

export function startRoomRealtimePublisher(
    stream: RoomRealtimeWritable,
    { getRoomSnapshot, subscribeRoomPublicationBatch, now }: RoomRealtimeStreamConfig,
): void {
    let baseline = getRoomSnapshot();
    let revision = 0;
    let isBaselineSent = false;
    let isClosed = false;
    let isWaitingForDrain = false;
    let activeBatch: PublicationBatch | undefined;
    let activeFrameIndex = 0;
    let waitingBatch: PublicationBatch | undefined;
    let unsubscribe: () => void = () => undefined;

    const onDrain = () => {
        if (isClosed) {
            return;
        }

        isWaitingForDrain = false;
        flush();
    };

    const close = once(() => {
        isClosed = true;
        stream.removeListener('drain', onDrain);
        unsubscribe();

        if (!stream.writableEnded && !stream.destroyed) {
            stream.end();
        }
    });

    unsubscribe = subscribeRoomPublicationBatch((batch) => {
        if (
            isClosed ||
            !isBaselineSent ||
            !isRoomSnapshotProjection(batch.snapshot) ||
            !hasSameDeviceSet(baseline, batch.snapshot)
        ) {
            close();

            return;
        }

        let built: BatchBuildResult;

        try {
            built = buildExplicitRoomDeltaBatch(baseline, batch, revision, now);
        } catch {
            close();

            return;
        }

        if (built.kind === 'invalid') {
            close();

            return;
        }

        baseline = batch.snapshot;

        if (built.kind === 'empty') {
            return;
        }

        revision = built.batch.nextRevision;
        enqueue(built.batch);
    });

    stream.once('close', close);
    stream.once('error', close);

    baseline = getRoomSnapshot();
    let initial: BatchBuildResult;

    try {
        initial = buildRoomSnapshotBatch(baseline, now);
    } catch {
        close();

        return;
    }

    if (initial.kind !== 'ready') {
        close();

        return;
    }

    isBaselineSent = true;
    revision = initial.batch.nextRevision;
    enqueue(initial.batch);

    function enqueue(batch: PublicationBatch): void {
        if (isClosed) {
            return;
        }

        if (!activeBatch && !isWaitingForDrain) {
            activeBatch = batch;
            activeFrameIndex = 0;
            flush();

            return;
        }

        if (waitingBatch) {
            close();

            return;
        }

        waitingBatch = batch;
    }

    function flush(): void {
        if (isClosed || isWaitingForDrain) {
            return;
        }

        while (activeBatch) {
            while (activeFrameIndex < activeBatch.frames.length) {
                const frame = activeBatch.frames[activeFrameIndex];

                if (!frame) {
                    close();

                    return;
                }

                try {
                    activeFrameIndex += 1;

                    if (!stream.write(frame)) {
                        isWaitingForDrain = true;
                        stream.once('drain', onDrain);

                        return;
                    }
                } catch {
                    close();

                    return;
                }
            }

            activeBatch = waitingBatch;
            waitingBatch = undefined;
            activeFrameIndex = 0;
        }
    }
}

function buildRoomSnapshotBatch(
    snapshot: RoomSnapshotProjection,
    now: () => string,
): BatchBuildResult {
    const sentAt = normalizedNow(now);

    if (!sentAt) {
        return { kind: 'invalid' };
    }

    return buildBatch(
        [
            {
                messageType: 'room.snapshot',
                revision: 0,
                sentAt,
                payload: toRoomBffSnapshot(snapshot),
            },
        ],
        0,
    );
}

function buildExplicitRoomDeltaBatch(
    previousSnapshot: RoomSnapshotProjection,
    batch: RoomPublicationBatch,
    revision: number,
    now: () => string,
): BatchBuildResult {
    const messages: RoomBffRealtimeServerMessage[] = [];
    let nextRevision = revision;

    for (const delta of toRoomBffPublicationDeltas(previousSnapshot, batch)) {
        const sentAt = normalizedNow(now);

        if (!sentAt) {
            return { kind: 'invalid' };
        }

        nextRevision += 1;
        messages.push({
            ...delta,
            previousRevision: nextRevision - 1,
            revision: nextRevision,
            sentAt,
        });
    }

    return messages.length === 0 ? { kind: 'empty' } : buildBatch(messages, nextRevision);
}

function buildBatch(
    messages: readonly RoomBffRealtimeServerMessage[],
    nextRevision: number,
): BatchBuildResult {
    if (messages.length === 0) {
        return { kind: 'empty' };
    }

    if (!messages.every(isRoomBffRealtimeServerMessage)) {
        return { kind: 'invalid' };
    }

    return {
        kind: 'ready',
        batch: {
            frames: messages.map(formatSseMessage),
            nextRevision,
        },
    };
}

function normalizedNow(now: () => string): string | undefined {
    try {
        return normalizeIsoTimestamp(now());
    } catch {
        return undefined;
    }
}

function formatSseMessage(message: RoomBffRealtimeServerMessage): string {
    return `event: ${message.messageType}\ndata: ${JSON.stringify(message)}\n\n`;
}

function hasSameDeviceSet(previous: RoomSnapshotProjection, next: RoomSnapshotProjection): boolean {
    if (previous.devices.length !== next.devices.length) {
        return false;
    }

    const previousDeviceIds = new Set(previous.devices.map((device) => device.deviceId));

    return next.devices.every((device) => previousDeviceIds.has(device.deviceId));
}

function once(callback: () => void): () => void {
    let hasRun = false;

    return () => {
        if (hasRun) {
            return;
        }

        hasRun = true;
        callback();
    };
}
