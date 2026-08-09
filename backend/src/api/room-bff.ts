import websocket from '@fastify/websocket';
import {
    type AcceptedCommandResponse,
    acceptedCommandResponseSchema,
    type RejectedCommandResponse,
    rejectedCommandResponseSchema,
    type SetPowerCommandRequest,
    setPowerCommandRequestSchema,
} from '@smart-room/contracts/commands';
import {
    apiErrorResponseSchema,
    type DeviceScenarioAction,
    type DeviceScenarioList,
    deviceScenarioListSchema,
    deviceScenarioParamsSchema,
    deviceScenarioRequestSchema,
    type DeviceScenarioResult,
    deviceScenarioResultSchema,
    eventProcessingDiagnosticsSnapshotSchema,
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
    requestCommand?: (request: SetPowerCommandRequest) => CommandRequestResult;
    runDeviceScenario?: (deviceId: string, action: DeviceScenarioAction) => DeviceScenarioResult;
    getDeviceScenarios?: (deviceId: string) => DeviceScenarioList | undefined;
    now?: () => string;
}

export function createRoomBffServer({
    getRoomSnapshot,
    getDiagnosticsSnapshot,
    subscribeRoomSnapshot,
    requestCommand,
    runDeviceScenario,
    getDeviceScenarios,
    now = realClock,
}: RoomBffConfig): FastifyInstance {
    const server = Fastify();
    const handlers: RoomBffHandlers = {
        getRoomSnapshot,
        getDiagnosticsSnapshot,
        requestCommand,
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
        if (
            (isDeviceScenarioRequest(request) || isCommandRequest(request)) &&
            isInvalidJsonBodyError(error)
        ) {
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

        if (isCommandRequest(request) && isInvalidScenarioRequestError(error)) {
            writeJson(response, 400, {
                error: 'invalid_request',
                message: 'Request body does not match a supported command.',
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
        '/room/commands',
        {
            schema: {
                body: setPowerCommandRequestSchema,
                response: {
                    202: acceptedCommandResponseSchema,
                    409: rejectedCommandResponseSchema,
                    422: rejectedCommandResponseSchema,
                    400: apiErrorResponseSchema,
                    415: apiErrorResponseSchema,
                    500: apiErrorResponseSchema,
                },
            },
            onRequest(request, response, done) {
                if (!isJsonMediaType(request.headers['content-type'])) {
                    void response.code(415).send({
                        error: 'unsupported_media_type',
                        message: 'Command requests must use application/json.',
                    });

                    return;
                }

                done();
            },
        },
        (request, response) => {
            const result = handlers.requestCommand?.(request.body as SetPowerCommandRequest);

            if (!result) {
                writeJson(response, 422, {
                    commandId: 'unavailable',
                    status: 'rejected',
                    reason: 'unsupported_command',
                    message: 'Command handling is not available.',
                });

                return;
            }

            if (!isCommandRequestResult(result)) {
                writeInvalidServerResponse(response);

                return;
            }

            writeJson(
                response,
                result.status === 'accepted' ? 202 : commandRejectionStatus(result),
                result,
            );
        },
    );

    server.post(
        '/dev/devices/:deviceId/scenarios',
        {
            schema: {
                params: deviceScenarioParamsSchema,
                body: deviceScenarioRequestSchema,
                response: {
                    200: deviceScenarioResultSchema,
                    400: apiErrorResponseSchema,
                    409: apiErrorResponseSchema,
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
            const action = (request.body as { action: DeviceScenarioAction }).action;

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
    requestCommand?: (request: SetPowerCommandRequest) => CommandRequestResult;
    runDeviceScenario?: (deviceId: string, action: DeviceScenarioAction) => DeviceScenarioResult;
    getDeviceScenarios?: (deviceId: string) => DeviceScenarioList | undefined;
}

export type CommandRequestResult = AcceptedCommandResponse | RejectedCommandResponse;

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
    action: DeviceScenarioAction,
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

        if (!isSchema(deviceScenarioResultSchema, result) || result.action !== action) {
            writeInvalidServerResponse(response);

            return;
        }

        writeJson(response, 200, result);
    } catch (error) {
        if (isScenarioConflictError(error)) {
            writeJson(response, 409, {
                error: 'scenario_conflict',
                message: error.message,
            });

            return;
        }

        writeJson(response, 500, {
            error: 'scenario_failed',
            message: 'Scenario could not be executed.',
        });
    }
}

function isScenarioConflictError(error: unknown): error is Error & { code: 'scenario_conflict' } {
    return error instanceof Error && 'code' in error && error.code === 'scenario_conflict';
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

function isCommandRequest(request: FastifyRequest): boolean {
    return request.url === '/room/commands';
}

function isCommandRequestResult(value: unknown): value is CommandRequestResult {
    return (
        isSchema(acceptedCommandResponseSchema, value) ||
        isSchema(rejectedCommandResponseSchema, value)
    );
}

function commandRejectionStatus(result: RejectedCommandResponse): 409 | 422 {
    return result.reason === 'command_already_active' ? 409 : 422;
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
    const nextDevices = new Map(next.devices.map((device) => [device.deviceId, device]));
    const commandDeviceIds = changedCommandDeviceIds(previous, next);

    for (const device of next.devices) {
        if (commandDeviceIds.has(device.deviceId)) {
            continue;
        }

        if (sameJson(previousDevices.get(device.deviceId), device)) {
            continue;
        }

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

    for (const deviceId of commandDeviceIds) {
        const device = nextDevices.get(deviceId);

        if (!device) {
            socket.close();

            return revision;
        }

        const sentAt = normalizeIsoTimestamp(now());

        if (!sentAt) {
            socket.close();

            return revision;
        }

        revision = sendRealtimeMessage(
            socket,
            {
                messageType: 'commands.updated',
                previousRevision: revision,
                revision: revision + 1,
                sentAt,
                payload: {
                    device,
                    activeCommands: next.activeCommands.filter(
                        (command) => command.deviceId === deviceId,
                    ),
                    recentCommands: next.recentCommands.filter(
                        (command) => command.deviceId === deviceId,
                    ),
                },
            },
            revision,
        );
    }

    return revision;
}

function changedCommandDeviceIds(
    previous: RoomSnapshotProjection,
    next: RoomSnapshotProjection,
): Set<string> {
    const deviceIds = new Set<string>();
    const previousCommands = [...previous.activeCommands, ...previous.recentCommands];
    const nextCommands = [...next.activeCommands, ...next.recentCommands];
    const commandIds = new Set([
        ...previousCommands.map((command) => command.commandId),
        ...nextCommands.map((command) => command.commandId),
    ]);

    for (const commandId of commandIds) {
        const previousCommand = previousCommands.find((command) => command.commandId === commandId);
        const nextCommand = nextCommands.find((command) => command.commandId === commandId);

        if (!sameJson(previousCommand, nextCommand)) {
            if (previousCommand) {
                deviceIds.add(previousCommand.deviceId);
            }

            if (nextCommand) {
                deviceIds.add(nextCommand.deviceId);
            }
        }
    }

    return deviceIds;
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
            if (error) {
                socket.close();
            }
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
    if (previous.devices.length !== next.devices.length) {
        return false;
    }

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
