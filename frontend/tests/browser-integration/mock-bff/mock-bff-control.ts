import type { APIRequestContext } from '@playwright/test';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type { RoomRealtimeServerMessage } from '@smart-room/contracts/realtime';

const mockBffControlUrl = 'http://127.0.0.1:4311/test/room';

export async function resetMockRoom(request: APIRequestContext): Promise<void> {
    await assertControlResponse(await request.post(`${mockBffControlUrl}/reset`));
}

export async function setMockRoomSnapshot(
    request: APIRequestContext,
    snapshot: RoomSnapshotProjection,
): Promise<void> {
    await assertControlResponse(
        await request.put(`${mockBffControlUrl}/snapshot`, { data: snapshot }),
    );
}

export async function publishMockRoomUpdate(
    request: APIRequestContext,
    message: Exclude<RoomRealtimeServerMessage, { messageType: 'room.snapshot' }>,
): Promise<void> {
    await assertControlResponse(
        await request.post(`${mockBffControlUrl}/realtime`, { data: message }),
    );
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
