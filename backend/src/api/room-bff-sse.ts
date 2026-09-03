import { type RoomSnapshotProjection } from '@smart-room/contracts/projections';
import {
    isRoomRealtimeServerMessage,
    isRoomSnapshotProjection,
    type RoomRealtimeServerMessage,
} from '@smart-room/contracts/realtime';
import { normalizeIsoTimestamp } from '@smart-room/contracts/validation';
import type { FastifyReply } from 'fastify';

interface RoomRealtimeStreamConfig {
    getRoomSnapshot(): RoomSnapshotProjection;
    subscribeRoomSnapshot(listener: (snapshot: RoomSnapshotProjection) => void): () => void;
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
    { getRoomSnapshot, subscribeRoomSnapshot, now }: RoomRealtimeStreamConfig,
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

    unsubscribe = subscribeRoomSnapshot((snapshot) => {
        if (isClosed || !isBaselineSent) {
            return;
        }

        if (!isRoomSnapshotProjection(snapshot) || !hasSameDeviceSet(baseline, snapshot)) {
            close();

            return;
        }

        const built = buildRoomDeltaBatch(baseline, snapshot, revision, now);

        if (built.kind === 'invalid') {
            close();

            return;
        }

        baseline = snapshot;

        if (built.kind === 'empty') {
            return;
        }

        revision = built.batch.nextRevision;
        enqueue(built.batch);
    });

    stream.once('close', close);
    stream.once('error', close);

    baseline = getRoomSnapshot();
    const initial = buildRoomSnapshotBatch(baseline, now);

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
                payload: snapshot,
            } as RoomRealtimeServerMessage,
        ],
        0,
    );
}

function buildRoomDeltaBatch(
    previous: RoomSnapshotProjection,
    next: RoomSnapshotProjection,
    revision: number,
    now: () => string,
): BatchBuildResult {
    const messages: RoomRealtimeServerMessage[] = [];
    let nextRevision = revision;
    const previousDevices = new Map(previous.devices.map((device) => [device.deviceId, device]));
    const commandDeviceIds = changedCommandDeviceIds(previous, next);

    for (const device of next.devices) {
        if (
            commandDeviceIds.has(device.deviceId) ||
            sameJson(previousDevices.get(device.deviceId), device)
        ) {
            continue;
        }

        const sentAt = normalizedNow(now);

        if (!sentAt) {
            return { kind: 'invalid' };
        }

        nextRevision += 1;
        messages.push({
            messageType: 'device.updated',
            previousRevision: nextRevision - 1,
            revision: nextRevision,
            sentAt,
            payload: device,
        } as RoomRealtimeServerMessage);
    }

    if (commandDeviceIds.size > 0) {
        const sentAt = normalizedNow(now);

        if (!sentAt) {
            return { kind: 'invalid' };
        }

        nextRevision += 1;
        messages.push({
            messageType: 'commands.updated',
            previousRevision: nextRevision - 1,
            revision: nextRevision,
            sentAt,
            payload: {
                devices: next.devices,
                activeCommands: next.activeCommands,
                recentCommands: next.recentCommands,
            },
        } as RoomRealtimeServerMessage);
    }

    if (next.platform && !sameJson(previous.platform, next.platform)) {
        const sentAt = normalizedNow(now);

        if (!sentAt) {
            return { kind: 'invalid' };
        }

        nextRevision += 1;
        messages.push({
            messageType: 'platform.updated',
            previousRevision: nextRevision - 1,
            revision: nextRevision,
            sentAt,
            payload: next.platform,
        } as RoomRealtimeServerMessage);
    }

    return buildBatch(messages, nextRevision);
}

function buildBatch(
    messages: readonly RoomRealtimeServerMessage[],
    nextRevision: number,
): BatchBuildResult {
    if (messages.length === 0) {
        return { kind: 'empty' };
    }

    if (!messages.every(isRoomRealtimeServerMessage)) {
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

function changedCommandDeviceIds(
    previous: RoomSnapshotProjection,
    next: RoomSnapshotProjection,
): Set<string> {
    const deviceIds = new Set<string>();
    const previousCommands = new Map(
        [...previous.activeCommands, ...previous.recentCommands].map((command) => [
            command.commandId,
            command,
        ]),
    );
    const nextCommands = new Map(
        [...next.activeCommands, ...next.recentCommands].map((command) => [
            command.commandId,
            command,
        ]),
    );
    const commandIds = new Set([...previousCommands.keys(), ...nextCommands.keys()]);

    for (const commandId of commandIds) {
        const previousCommand = previousCommands.get(commandId);
        const nextCommand = nextCommands.get(commandId);

        if (!sameJson(previousCommand, nextCommand)) {
            if (previousCommand) {
                deviceIds.add(previousCommand.deviceId);
            }

            if (nextCommand) {
                deviceIds.add(nextCommand.deviceId);
            }
        }
    }

    return deviceIds;
}

function formatSseMessage(message: RoomRealtimeServerMessage): string {
    return `event: ${message.messageType}\ndata: ${JSON.stringify(message)}\n\n`;
}

function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
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
