import websocket from '@fastify/websocket';
import {
    eventProcessingDiagnosticsSnapshotSchema,
    isRoomRealtimeServerMessage,
    isRoomSnapshotProjection,
    isSchema,
    normalizeIsoTimestamp,
    type RoomRealtimeServerMessage,
    type RoomSnapshotProjection,
    roomSnapshotProjectionSchema,
    type TemperatureScenarioAction,
    temperatureScenarioRequestSchema,
    type TemperatureScenarioResult,
    temperatureScenarioResultSchema,
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

        if (request.url === '/dev/scenarios/temperature' && isInvalidScenarioRequestError(error)) {
            writeJson(response, 400, {
                error: 'invalid_request',
                message: 'Request body contains an unsupported scenario action.',
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

    server.post(
        '/dev/scenarios/temperature',
        {
            schema: {
                body: temperatureScenarioRequestSchema,
                response: {
                    200: temperatureScenarioResultSchema,
                    415: {
                        type: 'object',
                        properties: {
                            error: { type: 'string' },
                            message: { type: 'string' },
                        },
                    },
                },
            },
            onRequest(request, response, done) {
                if (!isJsonMediaType(request.headers['content-type'])) {
                    void response.code(415).send({
                        error: 'unsupported_media_type',
                        message: 'Scenario requests must use application/json.',
                    });
                    return;
                }

                done();
            },
        },
        async (request, response) => {
            await handleTemperatureScenarioRequest(request, response, handlers.runScenario);
        },
    );

    server.route({
        method: ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        url: '/dev/scenarios/temperature',
        handler: async (request, response) => {
            await handleTemperatureScenarioRequest(request, response, handlers.runScenario);
        },
    });

    server.all(
        '/room',
        { schema: { response: { 200: roomSnapshotProjectionSchema } } },
        (request, response) => {
            handleRoomBffRequest(request, response, handlers);
        },
    );

    server.all(
        '/diagnostics',
        { schema: { response: { 200: eventProcessingDiagnosticsSnapshotSchema } } },
        (request, response) => {
            handleRoomBffRequest(request, response, handlers);
        },
    );

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
        const snapshot = handlers.getDiagnosticsSnapshot();

        if (!isSchema(eventProcessingDiagnosticsSnapshotSchema, snapshot)) {
            writeInvalidServerResponse(response);
            return;
        }

        writeJson(response, 200, snapshot);
        return;
    }

    const snapshot = handlers.getRoomSnapshot();

    if (!isRoomSnapshotProjection(snapshot)) {
        writeInvalidServerResponse(response);
        return;
    }

    writeJson(response, 200, snapshot);
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

    const action = (request.body as { action: TemperatureScenarioAction }).action;

    try {
        const result = runScenario(action);

        if (!isSchema(temperatureScenarioResultSchema, result) || result.action !== action) {
            writeInvalidServerResponse(response);
            return;
        }

        writeJson(response, 200, result);
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

function writeJson(response: FastifyReply, statusCode: number, body: unknown): void {
    void response
        .code(statusCode)
        .type('application/json')
        .send(body as Record<string, unknown>);
}

function writeInvalidServerResponse(response: FastifyReply): void {
    writeJson(response, 500, {
        error: 'invalid_server_response',
        message: 'Server produced a response that does not match the transport contract.',
    });
}

function isInvalidJsonBodyError(error: unknown): boolean {
    return (
        error instanceof Error && 'code' in error && error.code === 'FST_ERR_CTP_INVALID_JSON_BODY'
    );
}

function isInvalidScenarioRequestError(error: unknown): boolean {
    return error instanceof Error && 'validation' in error;
}

function isJsonMediaType(contentType: string | undefined): boolean {
    return contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function sendRoomSnapshot(
    socket: WebSocket,
    snapshot: RoomSnapshotProjection,
    now: () => string,
): void {
    if (socket.readyState !== WebSocket.OPEN) {
        return;
    }

    const sentAt = normalizeIsoTimestamp(now());

    if (!sentAt) {
        socket.close();
        return;
    }

    const message: RoomRealtimeServerMessage = {
        messageType: 'room.snapshot',
        version: 1,
        sentAt,
        payload: snapshot,
    };

    if (!isRoomRealtimeServerMessage(message)) {
        socket.close();
        return;
    }

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
