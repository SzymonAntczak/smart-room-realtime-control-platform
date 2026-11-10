import type { APIRequestContext, Page } from '@playwright/test';
import type { HistoryCursorErrorResponse, RawTelemetryPage } from '@smart-room/contracts/history';
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

export async function disconnectMockRealtime(
    request: APIRequestContext,
    options: { holdReconnect?: boolean } = {},
): Promise<void> {
    const url = new URL(mockBffUrls.disconnectRealtime);

    if (options.holdReconnect) {
        url.searchParams.set('holdReconnect', 'true');
    }

    await assertControlResponse(await request.post(url.href));
}

export async function resumeMockRealtime(request: APIRequestContext): Promise<void> {
    await assertControlResponse(await request.post(mockBffUrls.resumeRealtime));
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

export async function configureMockTelemetryHistory(
    request: APIRequestContext,
    value: {
        pages?: readonly RawTelemetryPage[];
        hold?: boolean;
        release?: boolean;
        error?: HistoryCursorErrorResponse;
    },
): Promise<void> {
    await assertControlResponse(
        await request.post(mockBffUrls.telemetryHistoryControl, { data: value }),
    );
}

export async function isMockTelemetryResponseHeld(request: APIRequestContext): Promise<boolean> {
    const response = await request.get(mockBffUrls.telemetryHistoryControl);
    await assertControlResponse(response);
    const body: unknown = await response.json();

    return typeof body === 'object' && body !== null && 'held' in body && body.held === true;
}

export function observeTelemetryHistoryRequests(page: Page): URL[] {
    const requests: URL[] = [];
    page.on('request', (request) => {
        const url = new URL(request.url());

        if (
            request.method() === 'GET' &&
            `${url.origin}${url.pathname}` === mockBffUrls.telemetryHistory
        ) {
            requests.push(url);
        }
    });

    return requests;
}
