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

export async function configureMockCommandResponse(
    request: APIRequestContext,
    value: { outcome: 'recovering' | 'volatile-accepted'; hold?: boolean },
): Promise<void> {
    await assertControlResponse(await request.post(mockBffUrls.commandControl, { data: value }));
}

export async function isMockCommandResponseHeld(request: APIRequestContext): Promise<boolean> {
    const response = await request.get(mockBffUrls.commandControl);

    if (!response.ok()) {
        throw new Error(`Mock BFF command control failed (${response.status()}).`);
    }

    const body: unknown = await response.json();

    return typeof body === 'object' && body !== null && 'held' in body && body.held === true;
}

export async function releaseMockCommandResponse(request: APIRequestContext): Promise<void> {
    await assertControlResponse(
        await request.post(mockBffUrls.commandControl, { data: { release: true } }),
    );
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
    value: {
        pages?: unknown;
        queries?: unknown;
        hold?: boolean;
        release?: boolean;
        status?: number;
        error?: unknown;
    },
): Promise<void> {
    await assertControlResponse(await request.post(mockBffUrls.historyControl, { data: value }));
}
