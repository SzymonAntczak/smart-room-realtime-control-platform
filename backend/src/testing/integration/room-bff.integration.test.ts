import { EventEmitter } from 'node:events';

import { isSignificantFactPage } from '@smart-room/contracts/history';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type { RoomPublicationBatch } from '@smart-room/contracts/realtime';
import {
    isRoomBffRealtimeServerMessage,
    type RoomBffRealtimeServerMessage,
} from '@smart-room/contracts/room-bff';
import { describe, expect, it } from 'vitest';

import { type RoomRealtimeWritable, startRoomRealtimePublisher } from '../../api/room-bff-sse';
import { toRoomBffSnapshot } from '../../api/user-history/user-history-projection';

import { createBackendIntegrationRuntime } from './backend-integration-runtime';

describe('BFF over native-source-mocked backend composition', () => {
    it('transforms a native availability outcome into validated BFF user history', async () => {
        const backend = await createBackendIntegrationRuntime();
        const stream = await backend.connectSse();
        backend.clock.advanceBy(1);
        backend.led().scenario.reportAvailability('offline', backend.clock.now());
        expect(
            await stream.waitFor(
                (message) =>
                    message.messageType === 'device.updated' &&
                    message.payload.deviceId === 'led-main',
            ),
        ).toMatchObject({
            messageType: 'device.updated',
            userHistory: [
                expect.objectContaining({ kind: 'availability_changed', current: 'offline' }),
            ],
        });
    });

    it('degrades storage and returns typed 503 after a pinned raw history read fails', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1);
        backend.led().scenario.reportAvailability('offline', backend.clock.now());
        const first = await backend.request('/room/history/significant-facts?pageSize=1');
        expect(first.status).toBe(200);

        if (!isSignificantFactPage(first.body) || !first.body.nextCursor) {
            throw new Error('Expected raw continuation');
        }

        backend.setReadsFailing(true);
        const failed = await backend.request(
            `/room/history/significant-facts?pageSize=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
        );
        expect(failed).toEqual({
            status: 503,
            body: {
                error: 'durable_history_unavailable',
                message: 'Durable history is currently unavailable.',
            },
        });
        expect((await backend.snapshot()).platform.storage.status).toBe('degraded');
        expect((await backend.request('/room/history/significant-facts?pageSize=1')).status).toBe(
            503,
        );
    });

    it('routes a development HTTP scenario through the native source and backend projection', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1);
        const action = await backend.request('/dev/devices/temp-desk/scenarios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'emit_next_reading' }),
        });
        expect(action.status).toBe(200);
        expect(
            (await backend.snapshot()).devices.find((device) => device.deviceId === 'temp-desk'),
        ).toMatchObject({
            reportedState: { temperature: 22 },
            observationStatus: { temperature: { lastObservedAt: backend.clock.now() } },
        });
    });

    it('streams only the changed device from a backend with two native sources', async () => {
        const backend = await createBackendIntegrationRuntime();
        const stream = await backend.connectSse();
        expect(stream.messages[0]).toMatchObject({
            messageType: 'room.snapshot',
            payload: {
                devices: expect.arrayContaining([
                    expect.objectContaining({ deviceId: 'temp-desk' }),
                    expect.objectContaining({ deviceId: 'temp-window' }),
                ]),
            },
        });
        backend.clock.advanceBy(1);
        backend.sources.window.read(20.2, backend.clock.now());
        expect(
            await stream.waitFor((message) => message.messageType === 'device.updated'),
        ).toMatchObject({
            previousRevision: 0,
            revision: 1,
            payload: {
                deviceId: 'temp-window',
                reportedState: { temperature: 20.2, temperatureUnit: 'celsius' },
            },
        });
        await stream.waitFor((message) => message.messageType === 'platform.updated');
        expect(
            stream.messages.filter((message) => message.messageType === 'device.updated'),
        ).toHaveLength(1);
    });

    it('gives an in-batch SSE publisher connection the final baseline and keeps wire revisions contiguous', async () => {
        const backend = await createBackendIntegrationRuntime();
        const wire = await backend.connectSse();
        const publishedBatches: RoomPublicationBatch[] = [];
        const unsubscribe = backend.runtime.subscribeRoomPublicationBatch((batch) =>
            publishedBatches.push(batch),
        );
        const second = new ObservedWritable();
        let opened = false;
        let firstBatchSnapshot: RoomSnapshotProjection | undefined;
        // A synchronous writable seam makes connecting inside serialization deterministic;
        // the real loopback HTTP/SSE connection independently verifies the same publication.
        const config = {
            getRoomSnapshot: backend.runtime.getRoomSnapshot,
            subscribeRoomPublicationBatch: backend.runtime.subscribeRoomPublicationBatch,
            now: backend.clock.now,
        };
        const first = new ObservedWritable((chunk) => {
            const message = decodeFrame(chunk);

            if (message?.messageType !== 'device.updated' || opened) {
                return;
            }

            opened = true;
            firstBatchSnapshot = publishedBatches[0]?.snapshot;
            startRoomRealtimePublisher(second, config);
            backend.sources.window.read(20.2, backend.clock.now());
        });

        try {
            startRoomRealtimePublisher(first, config);
            backend.clock.advanceBy(1);
            backend.sources.desk.read(22.5, backend.clock.now());
            const firstMessages = first.writes.map(decodeFrame);
            const secondMessages = second.writes.map(decodeFrame);
            expect(firstMessages.map((message) => message.messageType)).toEqual([
                'room.snapshot',
                'device.updated',
                'platform.updated',
                'device.updated',
                'platform.updated',
            ]);
            expect(secondMessages.map((message) => message.messageType)).toEqual([
                'room.snapshot',
                'device.updated',
                'platform.updated',
            ]);
            expect(firstMessages.map(revisions)).toEqual([
                [undefined, 0],
                [0, 1],
                [1, 2],
                [2, 3],
                [3, 4],
            ]);
            expect(secondMessages.map(revisions)).toEqual([
                [undefined, 0],
                [0, 1],
                [1, 2],
            ]);
            expect(firstMessages[1]).toMatchObject({ payload: { deviceId: 'temp-desk' } });
            expect(firstMessages[3]).toMatchObject({ payload: { deviceId: 'temp-window' } });
            expect(secondMessages[0]).toMatchObject({
                payload: {
                    devices: expect.arrayContaining([
                        expect.objectContaining({ deviceId: 'temp-desk' }),
                        expect.objectContaining({ deviceId: 'temp-window' }),
                    ]),
                },
            });

            if (!firstBatchSnapshot) {
                throw new Error('Missing atomic batch snapshot');
            }

            expect(secondMessages[0]?.payload).toEqual(toRoomBffSnapshot(firstBatchSnapshot));
            expect(secondMessages[1]).toMatchObject({
                messageType: 'device.updated',
                previousRevision: 0,
                revision: 1,
                payload: { deviceId: 'temp-window' },
            });
            await wire.waitFor((message) => message.revision === 4);
            expect(wire.messages.map(revisions)).toEqual([
                [undefined, 0],
                [0, 1],
                [1, 2],
                [2, 3],
                [3, 4],
            ]);
        } finally {
            first.emit('close');
            second.emit('close');
            unsubscribe();
        }
    });
});

class ObservedWritable extends EventEmitter implements RoomRealtimeWritable {
    readonly writes: string[] = [];
    readonly destroyed = false;
    writableEnded = false;
    constructor(private readonly onWrite?: (chunk: string) => void) {
        super();
    }
    end() {
        this.writableEnded = true;
    }
    write(chunk: string) {
        this.writes.push(chunk);
        this.onWrite?.(chunk);

        return true;
    }
}

function decodeFrame(frame: string): RoomBffRealtimeServerMessage {
    const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
    const message: unknown = JSON.parse(data);

    if (!isRoomBffRealtimeServerMessage(message)) {
        throw new Error('Invalid publisher SSE frame');
    }

    return message;
}

function revisions(message: RoomBffRealtimeServerMessage) {
    return ['previousRevision' in message ? message.previousRevision : undefined, message.revision];
}
