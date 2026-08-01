import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
    type RoomRealtimeServerMessage,
    type RoomSnapshotProjection,
    type TemperatureScenarioAction,
    temperatureScenarioRequestSchema,
    type TemperatureScenarioResult,
} from '@smart-room/contracts';
import { WebSocket, WebSocketServer } from 'ws';

import type { EventProcessingDiagnosticsSnapshot } from '../platform/event-processing/event-processing-diagnostics';

export interface RoomBffConfig {
    getRoomSnapshot(): RoomSnapshotProjection;
    getDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot;
    subscribeRoomSnapshot(listener: (snapshot: RoomSnapshotProjection) => void): () => void;
    runScenario?: (action: TemperatureScenarioAction) => TemperatureScenarioResult;
    now?: () => string;
}

export function createRoomBffServer({
    getRoomSnapshot,
    getDiagnosticsSnapshot,
    subscribeRoomSnapshot,
    runScenario,
    now = realClock,
}: RoomBffConfig): Server {
    const server = createServer((request, response) => {
        handleRoomBffRequest(request, response, {
            getRoomSnapshot,
            getDiagnosticsSnapshot,
            runScenario,
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
    runScenario?: (action: TemperatureScenarioAction) => TemperatureScenarioResult;
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

    if (url.pathname === '/dev/scenarios/temperature') {
        void handleTemperatureScenarioRequest(request, response, handlers.runScenario);
        return;
    }

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

async function handleTemperatureScenarioRequest(
    request: IncomingMessage,
    response: ServerResponse,
    runScenario: RoomBffHandlers['runScenario'],
): Promise<void> {
    if (!runScenario) {
        writeJson(response, 404, {
            error: 'not_found',
            message: 'Route not found.',
        });
        return;
    }

    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST, OPTIONS');
        writeJson(response, 405, {
            error: 'method_not_allowed',
            message: 'Only POST is supported for this route.',
        });
        return;
    }

    let action: TemperatureScenarioAction;

    try {
        const body = await readJsonBody(request);
        action = readTemperatureScenarioAction(body);
    } catch (error) {
        writeJson(response, 400, {
            error: 'invalid_request',
            message: error instanceof Error ? error.message : 'Invalid request.',
        });
        return;
    }

    try {
        writeJson(response, 200, runScenario(action));
    } catch {
        writeJson(response, 500, {
            error: 'scenario_failed',
            message: 'Scenario could not be executed.',
        });
    }
}

function setCorsHeaders(response: ServerResponse): void {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const content = Buffer.concat(chunks).toString('utf8');

    if (!content) {
        throw new TypeError('Request body must contain a scenario action.');
    }

    try {
        return JSON.parse(content) as unknown;
    } catch {
        throw new TypeError('Request body must be valid JSON.');
    }
}

function readTemperatureScenarioAction(value: unknown): TemperatureScenarioAction {
    const parsed = temperatureScenarioRequestSchema.safeParse(value);

    if (!parsed.success) {
        throw new TypeError('Request body contains an unsupported scenario action.');
    }

    return parsed.data.action;
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
