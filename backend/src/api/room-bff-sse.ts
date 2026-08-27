import type { ServerResponse } from 'node:http';

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

export function startRoomRealtimeStream(
    response: FastifyReply,
    { getRoomSnapshot, subscribeRoomSnapshot, now }: RoomRealtimeStreamConfig,
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

    let baseline = getRoomSnapshot();
    let revision = 0;
    let isBaselineSent = false;
    const unsubscribe = subscribeRoomSnapshot((snapshot) => {
        if (!isBaselineSent) {
            baseline = snapshot;

            return;
        }

        if (!isRoomSnapshotProjection(snapshot) || !hasSameDeviceSet(baseline, snapshot)) {
            stream.end();

            return;
        }

        revision = sendRoomDeltas(stream, baseline, snapshot, revision, now);
        baseline = snapshot;
    });
    const cleanup = once(unsubscribe);

    stream.once('close', cleanup);
    stream.once('error', cleanup);

    baseline = getRoomSnapshot();
    sendRoomSnapshot(stream, baseline, now);
    isBaselineSent = true;
}

function sendRoomSnapshot(
    stream: ServerResponse,
    snapshot: RoomSnapshotProjection,
    now: () => string,
): void {
    const sentAt = normalizedNow(stream, now);

    if (!sentAt) {
        return;
    }

    sendRealtimeMessage(
        stream,
        {
            messageType: 'room.snapshot',
            revision: 0,
            sentAt,
            payload: snapshot,
        } as RoomRealtimeServerMessage,
        0,
    );
}

function sendRoomDeltas(
    stream: ServerResponse,
    previous: RoomSnapshotProjection,
    next: RoomSnapshotProjection,
    revision: number,
    now: () => string,
): number {
    const previousDevices = new Map(previous.devices.map((device) => [device.deviceId, device]));
    const commandDeviceIds = changedCommandDeviceIds(previous, next);

    for (const device of next.devices) {
        if (
            commandDeviceIds.has(device.deviceId) ||
            sameJson(previousDevices.get(device.deviceId), device)
        ) {
            continue;
        }

        const sentAt = normalizedNow(stream, now);

        if (!sentAt) {
            return revision;
        }

        revision = sendRealtimeMessage(
            stream,
            {
                messageType: 'device.updated',
                previousRevision: revision,
                revision: revision + 1,
                sentAt,
                payload: device,
            } as RoomRealtimeServerMessage,
            revision,
        );
    }

    if (commandDeviceIds.size === 0) {
        return sendPlatformDelta(stream, previous, next, revision, now);
    }

    const sentAt = normalizedNow(stream, now);

    if (!sentAt) {
        return revision;
    }

    revision = sendRealtimeMessage(
        stream,
        {
            messageType: 'commands.updated',
            previousRevision: revision,
            revision: revision + 1,
            sentAt,
            payload: {
                devices: next.devices,
                activeCommands: next.activeCommands,
                recentCommands: next.recentCommands,
            },
        } as RoomRealtimeServerMessage,
        revision,
    );

    return sendPlatformDelta(stream, previous, next, revision, now);
}

function sendPlatformDelta(
    stream: ServerResponse,
    previous: RoomSnapshotProjection,
    next: RoomSnapshotProjection,
    revision: number,
    now: () => string,
): number {
    if (!next.platform || sameJson(previous.platform, next.platform)) {
        return revision;
    }

    const sentAt = normalizedNow(stream, now);

    if (!sentAt) {
        return revision;
    }

    return sendRealtimeMessage(
        stream,
        {
            messageType: 'platform.updated',
            previousRevision: revision,
            revision: revision + 1,
            sentAt,
            payload: next.platform,
        } as RoomRealtimeServerMessage,
        revision,
    );
}

function normalizedNow(stream: ServerResponse, now: () => string): string | undefined {
    if (stream.writableEnded || stream.destroyed) {
        return undefined;
    }

    const sentAt = normalizeIsoTimestamp(now());

    if (!sentAt) {
        stream.end();
    }

    return sentAt;
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

function sendRealtimeMessage(
    stream: ServerResponse,
    message: RoomRealtimeServerMessage,
    previousRevision: number,
): number {
    if (stream.writableEnded || stream.destroyed || !isRoomRealtimeServerMessage(message)) {
        stream.end();

        return previousRevision;
    }

    try {
        if (!stream.write(formatSseMessage(message))) {
            stream.end();

            return previousRevision;
        }

        return message.messageType === 'room.snapshot' ? 0 : message.revision;
    } catch {
        stream.end();

        return previousRevision;
    }
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
