import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { EventProcessingDiagnosticsSnapshot } from '../platform/event-processing/event-processing-diagnostics';
import type { RoomSnapshotProjection } from '../../../shared/src/projections';

export interface RoomBffConfig {
    getRoomSnapshot(): RoomSnapshotProjection;
    getDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot;
}

export function createRoomBffServer({
    getRoomSnapshot,
    getDiagnosticsSnapshot,
}: RoomBffConfig): Server {
    return createServer((request, response) => {
        handleRoomBffRequest(request, response, {
            getRoomSnapshot,
            getDiagnosticsSnapshot,
        });
    });
}

interface RoomBffHandlers {
    getRoomSnapshot(): RoomSnapshotProjection;
    getDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot;
}

function handleRoomBffRequest(
    request: IncomingMessage,
    response: ServerResponse,
    handlers: RoomBffHandlers,
): void {
    setCorsHeaders(response);

    if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
    }

    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname !== '/room' && url.pathname !== '/diagnostics') {
        writeJson(response, 404, {
            error: 'not_found',
            message: 'Route not found.',
        });
        return;
    }

    if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET, OPTIONS');
        writeJson(response, 405, {
            error: 'method_not_allowed',
            message: 'Only GET is supported for this route.',
        });
        return;
    }

    if (url.pathname === '/diagnostics') {
        writeJson(response, 200, handlers.getDiagnosticsSnapshot());
        return;
    }

    writeJson(response, 200, handlers.getRoomSnapshot());
}

function setCorsHeaders(response: ServerResponse): void {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json',
    });
    response.end(JSON.stringify(body));
}
