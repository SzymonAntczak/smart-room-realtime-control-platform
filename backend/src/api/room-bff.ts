import websocket from '@fastify/websocket';
import {
    type RoomRealtimeServerMessage,
    type RoomSnapshotProjection,
    type TemperatureScenarioAction,
    temperatureScenarioRequestSchema,
    type TemperatureScenarioResult,
} from '@smart-room/contracts';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';

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
}: RoomBffConfig): FastifyInstance {
    const server = Fastify();
    const handlers: RoomBffHandlers = {
        getRoomSnapshot,
        getDiagnosticsSnapshot,
        runScenario,
    };

    server.register(websocket);

    server.addHook('onRequest', async (request, response) => {
        setCorsHeaders(response);

        if (request.method === 'OPTIONS') {
            await response.code(204).send();
        }
    });

    server.setErrorHandler((error, request, response) => {
        if (request.url === '/dev/scenarios/temperature' && isInvalidJsonBodyError(error)) {
            writeJson(response, 400, {
                error: 'invalid_request',
                message: 'Request body must be valid JSON.',
            });
            return;
        }

        void response.send(error);
    });

    server.after(() => {
        server.get('/room/realtime', { websocket: true }, (socket) => {
            const unsubscribe = subscribeRoomSnapshot((snapshot) => {
                sendRoomSnapshot(socket, snapshot, now);
            });
            const cleanup = once(unsubscribe);

            socket.on('close', cleanup);
            socket.on('error', cleanup);

            sendRoomSnapshot(socket, getRoomSnapshot(), now);
        });
    });

    server.all('/dev/scenarios/temperature', async (request, response) => {
        await handleTemperatureScenarioRequest(request, response, handlers.runScenario);
    });

    server.all('/room', (request, response) => {
        handleRoomBffRequest(request, response, handlers);
    });

    server.all('/diagnostics', (request, response) => {
        handleRoomBffRequest(request, response, handlers);
    });

    server.setNotFoundHandler((_, response) => {
        writeJson(response, 404, {
            error: 'not_found',
            message: 'Route not found.',
        });
    });

    return server;
}

interface RoomBffHandlers {
    getRoomSnapshot(): RoomSnapshotProjection;
    getDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot;
    runScenario?: (action: TemperatureScenarioAction) => TemperatureScenarioResult;
}

function handleRoomBffRequest(
    request: FastifyRequest,
    response: FastifyReply,
    handlers: RoomBffHandlers,
): void {
    if (request.method !== 'GET') {
        response.header('Allow', 'GET, OPTIONS');
        writeJson(response, 405, {
            error: 'method_not_allowed',
            message: 'Only GET is supported for this route.',
        });
        return;
    }

    if (request.routeOptions.url === '/diagnostics') {
        writeJson(response, 200, handlers.getDiagnosticsSnapshot());
        return;
    }

    writeJson(response, 200, handlers.getRoomSnapshot());
}

async function handleTemperatureScenarioRequest(
    request: FastifyRequest,
    response: FastifyReply,
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
        response.header('Allow', 'POST, OPTIONS');
        writeJson(response, 405, {
            error: 'method_not_allowed',
            message: 'Only POST is supported for this route.',
        });
        return;
    }

    let action: TemperatureScenarioAction;

    try {
        action = readTemperatureScenarioAction(request.body);
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

function setCorsHeaders(response: FastifyReply): void {
    response.header('Access-Control-Allow-Origin', '*');
    response.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.header('Access-Control-Allow-Headers', 'Content-Type');
}

function readTemperatureScenarioAction(value: unknown): TemperatureScenarioAction {
    if (value === undefined || value === '') {
        throw new TypeError('Request body must contain a scenario action.');
    }

    let parsedBody: unknown = value;

    if (typeof value === 'string') {
        try {
            parsedBody = JSON.parse(value) as unknown;
        } catch {
            throw new TypeError('Request body must be valid JSON.');
        }
    }

    const parsed = temperatureScenarioRequestSchema.safeParse(parsedBody);

    if (!parsed.success) {
        throw new TypeError('Request body contains an unsupported scenario action.');
    }

    return parsed.data.action;
}

function writeJson(response: FastifyReply, statusCode: number, body: unknown): void {
    void response
        .code(statusCode)
        .type('application/json')
        .send(body as Record<string, unknown>);
}

function isInvalidJsonBodyError(error: unknown): boolean {
    return (
        error instanceof Error && 'code' in error && error.code === 'FST_ERR_CTP_INVALID_JSON_BODY'
    );
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
