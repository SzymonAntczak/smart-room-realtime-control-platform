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
    type NormalizedRawTelemetryPageQuery,
    type NormalizedTrendQuery,
    normalizeRawTelemetryPageQuery,
    normalizeTrendQuery,
    type RawTelemetryPage,
    rawTelemetryPageQuerySchema,
    rawTelemetryPageSchema,
    type SignificantFactPage,
    type SignificantFactPageQuery,
    significantFactPageQuerySchema,
    significantFactPageSchema,
    trendQuerySchema,
    type TrendResponse,
    trendResponseSchema,
} from '@smart-room/contracts/history';
import { type RoomSnapshotProjection } from '@smart-room/contracts/projections';
import {
    isRoomSnapshotProjection,
    type RoomPublicationBatch,
} from '@smart-room/contracts/realtime';
import { isRoomBffSnapshot, roomBffSnapshotSchema } from '@smart-room/contracts/room-bff';
import {
    durableHistoryUnavailableResponseSchema,
    normalizeUserHistoryPageQuery,
    userHistoryPageQuerySchema,
    userHistoryPageSchema,
} from '@smart-room/contracts/user-history';
import { isSchema } from '@smart-room/contracts/validation';
import Fastify, {
    type FastifyBaseLogger,
    type FastifyInstance,
    type FastifyReply,
    type FastifyRequest,
} from 'fastify';

import type { EventProcessingDiagnosticsSnapshot } from '../platform/event-processing/event-processing-diagnostics';
import type { RoomHistoryReadResult } from '../platform/history/room-history-reader';

import {
    isJsonMediaType,
    setCorsHeaders,
    writeInvalidServerResponse,
    writeJson,
} from './room-bff-http';
import { startRoomRealtimeStream } from './room-bff-sse';
import { createUserHistoryReader } from './user-history';
import { toRoomBffSnapshot } from './user-history/user-history-projection';

export interface RoomBffConfig {
    getRoomSnapshot(): RoomSnapshotProjection;
    getDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot;
    readSignificantFactPage?: (
        query: SignificantFactPageQuery,
    ) => RoomHistoryReadResult<SignificantFactPage>;
    readRawTelemetryPage?: (
        query: NormalizedRawTelemetryPageQuery,
    ) => RoomHistoryReadResult<RawTelemetryPage>;
    readTrend?: (query: NormalizedTrendQuery) => RoomHistoryReadResult<TrendResponse>;
    subscribeRoomPublicationBatch(listener: (batch: RoomPublicationBatch) => void): () => void;
    requestCommand?: (request: SetPowerCommandRequest) => CommandRequestResult;
    runDeviceScenario?: (deviceId: string, action: DeviceScenarioAction) => DeviceScenarioResult;
    getDeviceScenarios?: (deviceId: string) => DeviceScenarioList | undefined;
    loggerInstance?: FastifyBaseLogger;
    now?: () => string;
}

export function createRoomBffServer({
    getRoomSnapshot,
    getDiagnosticsSnapshot,
    readSignificantFactPage,
    readRawTelemetryPage,
    readTrend,
    subscribeRoomPublicationBatch,
    requestCommand,
    runDeviceScenario,
    getDeviceScenarios,
    loggerInstance,
    now = realClock,
}: RoomBffConfig): FastifyInstance {
    const server = loggerInstance ? Fastify({ loggerInstance }) : Fastify();
    const userHistoryReader = readSignificantFactPage
        ? createUserHistoryReader({ readSignificantFactPage, getRoomSnapshot })
        : undefined;
    const handlers: RoomBffHandlers = {
        getRoomSnapshot,
        getDiagnosticsSnapshot,
        readSignificantFactPage,
        readRawTelemetryPage,
        readTrend,
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

        if (isHistoryRequest(request) && isInvalidScenarioRequestError(error)) {
            writeJson(response, 400, {
                error: 'invalid_request',
                message: 'History query parameters do not match the transport contract.',
            });

            return;
        }

        void response.send(error);
    });

    server.get('/room/realtime', (_, response) => {
        startRoomRealtimeStream(response, {
            getRoomSnapshot,
            subscribeRoomPublicationBatch,
            now,
        });
    });

    server.get(
        '/room/history/user-history',
        {
            schema: {
                querystring: userHistoryPageQuerySchema,
                response: {
                    200: userHistoryPageSchema,
                    400: apiErrorResponseSchema,
                    503: durableHistoryUnavailableResponseSchema,
                    500: apiErrorResponseSchema,
                },
            },
            // Fastify's default Ajv removes additional query keys and can coerce arrays.
            // Reject unsupported fields/repeated values before that mutation occurs.
            preValidation(request, response, done) {
                const query = request.query;

                if (
                    typeof query !== 'object' ||
                    query === null ||
                    Object.entries(query).some(
                        ([key, value]) =>
                            !['pageSize', 'cursor', 'deviceId', 'from', 'to'].includes(key) ||
                            typeof value !== 'string',
                    )
                ) {
                    writeJson(response, 400, {
                        error: 'invalid_request',
                        message: 'History query parameters do not match the transport contract.',
                    });

                    return;
                }

                done();
            },
        },
        (request, response) => {
            const query = normalizeUserHistoryPageQuery(request.query);

            if (!query) {
                writeJson(response, 400, {
                    error: 'invalid_request',
                    message: 'History query parameters do not match the transport contract.',
                });

                return;
            }

            if (!userHistoryReader) {
                writeInvalidServerResponse(response);

                return;
            }

            writeHistoryReadResponse(response, userHistoryReader.readPage(query));
        },
    );

    server.get(
        '/room/history/significant-facts',
        {
            schema: {
                querystring: significantFactPageQuerySchema,
                response: {
                    200: significantFactPageSchema,
                    400: apiErrorResponseSchema,
                    503: apiErrorResponseSchema,
                    500: apiErrorResponseSchema,
                },
            },
        },
        (request, response) => {
            const read = handlers.readSignificantFactPage;

            if (!read) {
                writeInvalidServerResponse(response);

                return;
            }

            writeHistoryReadResponse(response, read(request.query as SignificantFactPageQuery));
        },
    );

    server.get(
        '/room/history/telemetry',
        {
            schema: {
                querystring: rawTelemetryPageQuerySchema,
                response: {
                    200: rawTelemetryPageSchema,
                    400: apiErrorResponseSchema,
                    503: apiErrorResponseSchema,
                    500: apiErrorResponseSchema,
                },
            },
        },
        (request, response) => {
            const query = normalizeRawTelemetryPageQuery(request.query);

            if (!query) {
                writeJson(response, 400, {
                    error: 'invalid_request',
                    message: 'Telemetry history requires a non-empty time range.',
                });

                return;
            }

            const read = handlers.readRawTelemetryPage;

            if (!read) {
                writeInvalidServerResponse(response);

                return;
            }

            writeHistoryReadResponse(response, read(query));
        },
    );

    server.get(
        '/room/history/trends',
        {
            schema: {
                querystring: trendQuerySchema,
                response: {
                    200: trendResponseSchema,
                    400: apiErrorResponseSchema,
                    503: apiErrorResponseSchema,
                    500: apiErrorResponseSchema,
                },
            },
        },
        (request, response) => {
            const query = normalizeTrendQuery(request.query);

            if (!query) {
                writeJson(response, 400, {
                    error: 'invalid_request',
                    message: 'Telemetry trend requires a non-empty time range.',
                });

                return;
            }

            const read = handlers.readTrend;

            if (!read) {
                writeInvalidServerResponse(response);

                return;
            }

            writeHistoryReadResponse(response, read(query));
        },
    );

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
        { schema: { response: { 200: roomBffSnapshotSchema } } },
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
    readSignificantFactPage?: RoomBffConfig['readSignificantFactPage'];
    readRawTelemetryPage?: RoomBffConfig['readRawTelemetryPage'];
    readTrend?: RoomBffConfig['readTrend'];
    requestCommand?: (request: SetPowerCommandRequest) => CommandRequestResult;
    runDeviceScenario?: (deviceId: string, action: DeviceScenarioAction) => DeviceScenarioResult;
    getDeviceScenarios?: (deviceId: string) => DeviceScenarioList | undefined;
}

export type CommandRequestResult =
    | AcceptedCommandResponse
    | RejectedCommandResponse
    | PreAdmissionCommandErrorResponse;

function writeHistoryReadResponse<Value>(
    response: FastifyReply,
    result: RoomHistoryReadResult<Value>,
): void {
    if (result.status === 'available') {
        writeJson(response, 200, result.value);

        return;
    }

    if (result.status === 'invalid_internal_data') {
        writeInvalidServerResponse(response);

        return;
    }

    if (result.status === 'cursor_error') {
        writeJson(response, 400, result.error);

        return;
    }

    writeJson(response, 503, {
        error: 'durable_history_unavailable',
        message: 'Durable history is currently unavailable.',
    });
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

    try {
        const result = toRoomBffSnapshot(snapshot);

        if (!isRoomBffSnapshot(result)) {
            writeInvalidServerResponse(response);

            return;
        }

        writeJson(response, 200, result);
    } catch {
        writeInvalidServerResponse(response);
    }
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

function isHistoryRequest(request: FastifyRequest): boolean {
    return request.routeOptions.url?.startsWith('/room/history/') ?? false;
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
