import websocket from '@fastify/websocket';
import {
    apiErrorResponseSchema,
    type DeviceScenarioList,
    deviceScenarioListSchema,
    deviceScenarioParamsSchema,
    eventProcessingDiagnosticsSnapshotSchema,
    type TemperatureScenarioAction,
    temperatureScenarioRequestSchema,
    type TemperatureScenarioResult,
    temperatureScenarioResultSchema,
} from '@smart-room/contracts/development';
import {
    type RoomSnapshotProjection,
    roomSnapshotProjectionSchema,
} from '@smart-room/contracts/projections';
import {
    isRoomRealtimeServerMessage,
    isRoomSnapshotProjection,
    type RoomRealtimeServerMessage,
} from '@smart-room/contracts/realtime';
import { isSchema, normalizeIsoTimestamp } from '@smart-room/contracts/validation';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';

import type { EventProcessingDiagnosticsSnapshot } from '../platform/event-processing/event-processing-diagnostics';

export interface RoomBffConfig {
    getRoomSnapshot(): RoomSnapshotProjection;
    getDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot;
    subscribeRoomSnapshot(listener: (snapshot: RoomSnapshotProjection) => void): () => void;
    runDeviceScenario?: (
        deviceId: string,
        action: TemperatureScenarioAction,
    ) => TemperatureScenarioResult;
    getDeviceScenarios?: (deviceId: string) => DeviceScenarioList | undefined;
    now?: () => string;
}

export function createRoomBffServer({
    getRoomSnapshot,
    getDiagnosticsSnapshot,
    subscribeRoomSnapshot,
    runDeviceScenario,
    getDeviceScenarios,
    now = realClock,
}: RoomBffConfig): FastifyInstance {
    const server = Fastify();
    const handlers: RoomBffHandlers = {
        getRoomSnapshot,
        getDiagnosticsSnapshot,
        runDeviceScenario,
        getDeviceScenarios,
    };

    server.register(websocket);

    server.addHook('onRequest', async (request, response) => {
        setCorsHeaders(response);

        if (request.method === 'OPTIONS') {
            await response.code(204).send();
        }
    });

    server.setErrorHandler((error, request, response) => {
        if (isDeviceScenarioRequest(request) && isInvalidJsonBodyError(error)) {
            writeJson(response, 400, {
                error: 'invalid_request',
                message: 'Request body must be valid JSON.',
            });
            return;
        }

        if (isDeviceScenarioRequest(request) && isInvalidScenarioRequestError(error)) {
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
            let baseline = getRoomSnapshot();
            let revision = 0;
            let isBaselineSent = false;
            const unsubscribe = subscribeRoomSnapshot((snapshot) => {
                if (!isBaselineSent) {
                    baseline = snapshot;
                    return;
                }
                if (!hasSameDeviceSet(baseline, snapshot)) {
                    socket.close();
                    return;
                }
                revision = sendRoomDeltas(socket, baseline, snapshot, revision, now);
                baseline = snapshot;
            });
            const cleanup = once(unsubscribe);

            socket.on('close', cleanup);
            socket.on('error', cleanup);

            baseline = getRoomSnapshot();
            sendRoomSnapshot(socket, baseline, now);
            isBaselineSent = true;
        });
    });

    server.get(
        '/dev/devices/:deviceId/scenarios',
        {
            schema: {
                params: deviceScenarioParamsSchema,
                response: { 200: deviceScenarioListSchema, 404: apiErrorResponseSchema },
            },
        },
        (request, response) => {
            const deviceId = (request.params as { deviceId: string }).deviceId;
            const scenarios = handlers.getDeviceScenarios?.(deviceId);

            if (
                !scenarios ||
                !isSchema(deviceScenarioListSchema, scenarios) ||
                scenarios.deviceId !== deviceId
            ) {
                writeJson(response, 404, {
                    error: 'not_found',
                    message: 'Device scenarios not found.',
                });
                return;
            }

            writeJson(response, 200, scenarios);
        },
    );

    server.post(
        '/dev/devices/:deviceId/scenarios',
        {
            schema: {
                params: deviceScenarioParamsSchema,
                body: temperatureScenarioRequestSchema,
                response: {
                    200: temperatureScenarioResultSchema,
                    400: apiErrorResponseSchema,
                    404: apiErrorResponseSchema,
                    415: apiErrorResponseSchema,
                    500: apiErrorResponseSchema,
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
            const deviceId = (request.params as { deviceId: string }).deviceId;
            const scenarios = handlers.getDeviceScenarios?.(deviceId);
            const action = (request.body as { action: TemperatureScenarioAction }).action;

            if (
                !scenarios ||
                !isSchema(deviceScenarioListSchema, scenarios) ||
                scenarios.deviceId !== deviceId
            ) {
                writeJson(response, 404, {
                    error: 'not_found',
                    message: 'Device scenarios not found.',
                });
                return;
            }

            if (!scenarios.scenarios.some((scenario) => scenario.action === action)) {
                writeJson(response, 400, {
                    error: 'invalid_request',
                    message: 'Request body contains an unsupported scenario action.',
                });
                return;
            }

            await handleDeviceScenarioRequest(
                deviceId,
                action,
                response,
                handlers.runDeviceScenario,
            );
        },
    );

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
    runDeviceScenario?: (
        deviceId: string,
        action: TemperatureScenarioAction,
    ) => TemperatureScenarioResult;
    getDeviceScenarios?: (deviceId: string) => DeviceScenarioList | undefined;
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

async function handleDeviceScenarioRequest(
    deviceId: string,
    action: TemperatureScenarioAction,
    response: FastifyReply,
    runDeviceScenario: RoomBffHandlers['runDeviceScenario'],
): Promise<void> {
    if (!runDeviceScenario) {
        writeJson(response, 404, {
            error: 'not_found',
            message: 'Route not found.',
        });
        return;
    }

    try {
        const result = runDeviceScenario(deviceId, action);

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

function isDeviceScenarioRequest(request: FastifyRequest): boolean {
    return request.url.startsWith('/dev/devices/') && request.url.endsWith('/scenarios');
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
        revision: 0,
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

function sendRoomDeltas(
    socket: WebSocket,
    previous: RoomSnapshotProjection,
    next: RoomSnapshotProjection,
    revision: number,
    now: () => string,
): number {
    const previousDevices = new Map(previous.devices.map((device) => [device.deviceId, device]));

    for (const device of next.devices) {
        if (sameJson(previousDevices.get(device.deviceId), device)) continue;

        const sentAt = normalizeIsoTimestamp(now());
        if (!sentAt) {
            socket.close();
            return revision;
        }

        revision = sendRealtimeMessage(
            socket,
            {
                messageType: 'device.updated',
                previousRevision: revision,
                revision: revision + 1,
                sentAt,
                payload: device,
            },
            revision,
        );
    }

    return revision;
}

function sendRealtimeMessage(
    socket: WebSocket,
    message: RoomRealtimeServerMessage,
    previousRevision: number,
): number {
    if (socket.readyState !== WebSocket.OPEN || !isRoomRealtimeServerMessage(message)) {
        socket.close();
        return previousRevision;
    }

    try {
        socket.send(JSON.stringify(message), (error) => {
            if (error) socket.close();
        });
        return message.messageType === 'room.snapshot' ? 0 : message.revision;
    } catch {
        socket.close();
        return previousRevision;
    }
}

function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function hasSameDeviceSet(previous: RoomSnapshotProjection, next: RoomSnapshotProjection): boolean {
    if (previous.devices.length !== next.devices.length) return false;

    const previousDeviceIds = new Set(previous.devices.map((device) => device.deviceId));
    const nextDeviceIds = new Set(next.devices.map((device) => device.deviceId));
    return (
        previousDeviceIds.size === previous.devices.length &&
        nextDeviceIds.size === next.devices.length &&
        next.devices.every((device) => previousDeviceIds.has(device.deviceId))
    );
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
