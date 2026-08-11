import type { APIRequestContext } from '@playwright/test';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type { RoomRealtimeServerMessage } from '@smart-room/contracts/realtime';

import { mockBffUrls } from '../browser-test-runtime';

export async function resetMockRoom(request: APIRequestContext): Promise<void> {
    await assertControlResponse(await request.post(mockBffUrls.reset));
}

export async function rejectNextMockCommand(request: APIRequestContext): Promise<void> {
    await assertControlResponse(await request.post(mockBffUrls.rejectNextCommand));
}

export async function setMockRoomSnapshot(
    request: APIRequestContext,
    snapshot: RoomSnapshotProjection,
): Promise<void> {
    await assertControlResponse(await request.put(mockBffUrls.snapshot, { data: snapshot }));
}

export async function publishMockRoomUpdate(
    request: APIRequestContext,
    message: Exclude<RoomRealtimeServerMessage, { messageType: 'room.snapshot' }>,
): Promise<void> {
    await assertControlResponse(
        await request.post(mockBffUrls.scenarioRealtime, { data: message }),
    );
}

export async function disconnectMockRealtime(request: APIRequestContext): Promise<void> {
    await assertControlResponse(await request.post(mockBffUrls.disconnectRealtime));
}

async function assertControlResponse(
    response: Awaited<ReturnType<APIRequestContext['post']>>,
): Promise<void> {
    if (response.ok()) {
        return;
    }

    throw new Error(
        `Mock BFF scenario control failed (${response.status()}): ${await response.text()}`,
    );
}
