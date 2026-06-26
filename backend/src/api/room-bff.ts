import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { EventProcessingDiagnosticsSnapshot } from '../platform/event-processing/event-processing-diagnostics';
import type { RoomSnapshotProjection } from '../../../shared/src/projections';
import type { RoomRealtimeServerMessage } from '../../../shared/src/realtime';

export interface RoomBffConfig {
    getRoomSnapshot(): RoomSnapshotProjection;
    getDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot;
    subscribeRoomSnapshot(listener: (snapshot: RoomSnapshotProjection) => void): () => void;
    now?: () => string;
}

export function createRoomBffServer({
    getRoomSnapshot,
    getDiagnosticsSnapshot,
    subscribeRoomSnapshot,
    now = realClock,
}: RoomBffConfig): Server {
    const server = createServer((request, response) => {
        handleRoomBffRequest(request, response, {
            getRoomSnapshot,
            getDiagnosticsSnapshot,
        });
    });
    const websocketServer = new WebSocketServer({
        noServer: true,
    });

    websocketServer.on('connection', (socket) => {
        const unsubscribe = subscribeRoomSnapshot((snapshot) => {
            sendRoomSnapshot(socket, snapshot, now);
        });
        const cleanup = once(unsubscribe);

        socket.on('close', cleanup);
        socket.on('error', cleanup);

        sendRoomSnapshot(socket, getRoomSnapshot(), now);
    });

    server.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url ?? '/', 'http://localhost');

        if (url.pathname !== '/room/realtime') {
            socket.destroy();
            return;
        }

        websocketServer.handleUpgrade(request, socket, head, (websocket) => {
            websocketServer.emit('connection', websocket, request);
        });
    });

    server.on('close', () => {
        websocketServer.close();
    });

    return server;
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

function sendRoomSnapshot(
    socket: WebSocket,
    snapshot: RoomSnapshotProjection,
    now: () => string,
): void {
    if (socket.readyState !== WebSocket.OPEN) {
        return;
    }

    const message: RoomRealtimeServerMessage = {
        messageType: 'room.snapshot',
        version: 1,
        sentAt: now(),
        payload: snapshot,
    };

    try {
        socket.send(JSON.stringify(message), (error) => {
            if (error) {
                socket.close();
            }
        });
    } catch {
        socket.close();
    }
}

function realClock(): string {
    return new Date().toISOString();
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
