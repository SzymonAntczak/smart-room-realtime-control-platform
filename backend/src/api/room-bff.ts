import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { RoomSnapshotProjection } from '../../../shared/src/projections';

export interface RoomBffConfig {
    getRoomSnapshot(): RoomSnapshotProjection;
}

export function createRoomBffServer({ getRoomSnapshot }: RoomBffConfig): Server {
    return createServer((request, response) => {
        handleRoomBffRequest(request, response, getRoomSnapshot);
    });
}

function handleRoomBffRequest(
    request: IncomingMessage,
    response: ServerResponse,
    getRoomSnapshot: () => RoomSnapshotProjection,
): void {
    setCorsHeaders(response);

    if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
    }

    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname !== '/room') {
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

    writeJson(response, 200, getRoomSnapshot());
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
