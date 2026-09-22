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
    type NormalizedRawTelemetryFirstPageQuery,
    type NormalizedTrendQuery,
    normalizeRawTelemetryFirstPageQuery,
    normalizeTrendQuery,
    rawTelemetryFirstPageQuerySchema,
    type RawTelemetryPage,
    rawTelemetryPageSchema,
    type SignificantFactFirstPageQuery,
    significantFactFirstPageQuerySchema,
    type SignificantFactPage,
    significantFactPageSchema,
    trendQuerySchema,
    type TrendResponse,
    trendResponseSchema,
} from '@smart-room/contracts/history';
import {
    type RoomSnapshotProjection,
    roomSnapshotProjectionSchema,
} from '@smart-room/contracts/projections';
import {
    isRoomSnapshotProjection,
    type RoomPublicationBatch,
} from '@smart-room/contracts/realtime';
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

export interface RoomBffConfig {
    getRoomSnapshot(): RoomSnapshotProjection;
    getDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot;
    readSignificantFactFirstPage?: (
        query: SignificantFactFirstPageQuery,
    ) => RoomHistoryReadResult<SignificantFactPage>;
    readRawTelemetryFirstPage?: (
        query: NormalizedRawTelemetryFirstPageQuery,
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
    readSignificantFactFirstPage,
    readRawTelemetryFirstPage,
    readTrend,
    subscribeRoomPublicationBatch,
    requestCommand,
    runDeviceScenario,
    getDeviceScenarios,
    loggerInstance,
    now = realClock,
}: RoomBffConfig): FastifyInstance {
    const server = loggerInstance ? Fastify({ loggerInstance }) : Fastify();
    const handlers: RoomBffHandlers = {
        getRoomSnapshot,
        getDiagnosticsSnapshot,
        readSignificantFactFirstPage,
        readRawTelemetryFirstPage,
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
        '/room/history/significant-facts',
        {
            schema: {
                querystring: significantFactFirstPageQuerySchema,
                response: {
                    200: significantFactPageSchema,
                    400: apiErrorResponseSchema,
                    503: apiErrorResponseSchema,
                    500: apiErrorResponseSchema,
                },
            },
            onRequest(request, response, done) {
                if (rejectUnsupportedHistoryCursor(request, response)) {
                    return;
                }

                done();
            },
        },
        (request, response) => {
            const read = handlers.readSignificantFactFirstPage;

            if (!read) {
                writeInvalidServerResponse(response);

                return;
            }

            writeHistoryReadResponse(
                response,
                read(request.query as SignificantFactFirstPageQuery),
            );
        },
    );

    server.get(
        '/room/history/telemetry',
        {
            schema: {
                querystring: rawTelemetryFirstPageQuerySchema,
                response: {
                    200: rawTelemetryPageSchema,
                    400: apiErrorResponseSchema,
                    503: apiErrorResponseSchema,
                    500: apiErrorResponseSchema,
                },
            },
            onRequest(request, response, done) {
                if (rejectUnsupportedHistoryCursor(request, response)) {
                    return;
                }

                done();
            },
        },
        (request, response) => {
            const query = normalizeRawTelemetryFirstPageQuery(request.query);

            if (!query) {
                writeJson(response, 400, {
                    error: 'invalid_request',
                    message: 'Telemetry history requires a non-empty time range.',
                });

                return;
            }

            const read = handlers.readRawTelemetryFirstPage;

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
    readSignificantFactFirstPage?: RoomBffConfig['readSignificantFactFirstPage'];
    readRawTelemetryFirstPage?: RoomBffConfig['readRawTelemetryFirstPage'];
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

    writeJson(response, 503, {
        error: 'durable_history_unavailable',
        message: 'Durable history is currently unavailable.',
    });
}

function rejectUnsupportedHistoryCursor(request: FastifyRequest, response: FastifyReply): boolean {
    const requestUrl = request.raw.url;

    if (!requestUrl || !new URL(requestUrl, 'http://localhost').searchParams.has('cursor')) {
        return false;
    }

    writeJson(response, 400, {
        error: 'invalid_request',
        message: 'History cursors are not available until the next history subtask.',
    });

    return true;
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
