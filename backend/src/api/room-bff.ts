import {
    type AcceptedCommandResponse,
    acceptedCommandResponseSchema,
    type PreAdmissionCommandErrorResponse,
    preAdmissionCommandErrorResponseSchema,
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
import { isRoomSnapshotProjection } from '@smart-room/contracts/realtime';
import { isSchema } from '@smart-room/contracts/validation';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import type { EventProcessingDiagnosticsSnapshot } from '../platform/event-processing/event-processing-diagnostics';

import {
    isJsonMediaType,
    setCorsHeaders,
    writeInvalidServerResponse,
    writeJson,
} from './room-bff-http';
import { startRoomRealtimeStream } from './room-bff-sse';

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

    server.get('/room/realtime', (_, response) => {
        startRoomRealtimeStream(response, { getRoomSnapshot, subscribeRoomSnapshot, now });
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
                    404: preAdmissionCommandErrorResponseSchema,
                    503: preAdmissionCommandErrorResponseSchema,
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
            const requestCommand = handlers.requestCommand;

            if (!requestCommand) {
                writeInvalidServerResponse(response);

                return;
            }

            const result = requestCommand(request.body as SetPowerCommandRequest);

            if (!isCommandRequestResult(result)) {
                writeInvalidServerResponse(response);

                return;
            }

            if ('error' in result) {
                writeJson(response, result.error === 'platform_recovering' ? 503 : 404, result);
            } else {
                writeJson(
                    response,
                    result.status === 'accepted' ? 202 : commandRejectionStatus(result),
                    result,
                );
            }
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

export type CommandRequestResult =
    | AcceptedCommandResponse
    | RejectedCommandResponse
    | PreAdmissionCommandErrorResponse;

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

function isInvalidJsonBodyError(error: unknown): boolean {
    return (
        error instanceof Error && 'code' in error && error.code === 'FST_ERR_CTP_INVALID_JSON_BODY'
    );
}

function isInvalidScenarioRequestError(error: unknown): boolean {
    return error instanceof Error && 'validation' in error;
}

function isDeviceScenarioRequest(request: FastifyRequest): boolean {
    return request.routeOptions.url === '/dev/devices/:deviceId/scenarios';
}

function isCommandRequest(request: FastifyRequest): boolean {
    return request.routeOptions.url === '/room/commands';
}

function isCommandRequestResult(value: unknown): value is CommandRequestResult {
    return (
        isSchema(acceptedCommandResponseSchema, value) ||
        isSchema(rejectedCommandResponseSchema, value) ||
        isSchema(preAdmissionCommandErrorResponseSchema, value)
    );
}

function commandRejectionStatus(result: RejectedCommandResponse): 409 | 422 {
    return result.reason === 'command_already_active' ? 409 : 422;
}

function realClock(): string {
    return new Date().toISOString();
}
