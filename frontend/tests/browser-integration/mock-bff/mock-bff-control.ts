import type { APIRequestContext } from '@playwright/test';
import type { RoomBffSnapshot } from '@smart-room/contracts/room-bff';
import type { RoomBffRealtimeServerMessage } from '@smart-room/contracts/room-bff';

import { mockBffUrls } from '../browser-test-runtime';

export async function resetMockRoom(request: APIRequestContext): Promise<void> {
    await assertControlResponse(await request.post(mockBffUrls.reset));
}

export async function rejectNextMockCommand(request: APIRequestContext): Promise<void> {
    await assertControlResponse(await request.post(mockBffUrls.rejectNextCommand));
}

export async function publishAcceptedCommandBeforeResponse(
    request: APIRequestContext,
): Promise<void> {
    await assertControlResponse(await request.post(mockBffUrls.publishAcceptedBeforeResponse));
}

export async function setMockRoomSnapshot(
    request: APIRequestContext,
    snapshot: RoomBffSnapshot,
): Promise<void> {
    await assertControlResponse(await request.put(mockBffUrls.snapshot, { data: snapshot }));
}

export async function publishMockRoomUpdate(
    request: APIRequestContext,
    message: Exclude<RoomBffRealtimeServerMessage, { messageType: 'room.snapshot' }>,
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

export async function configureMockHistory(
    request: APIRequestContext,
    value: { pages?: unknown; hold?: boolean; release?: boolean; status?: number; error?: unknown },
): Promise<void> {
    await assertControlResponse(await request.post(mockBffUrls.historyControl, { data: value }));
}
