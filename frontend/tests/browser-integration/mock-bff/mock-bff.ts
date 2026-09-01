import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { browserTestRuntime, browserTestUrls, mockBffPaths } from '../browser-test-runtime';

import {
    assertMockRejectedCommandResponse,
    parseMockSetPowerCommandRequest,
    serializeMockSseMessage,
} from './mock-bff-contracts';
import {
    createCommandsUpdatedMessage,
    createFailedLedCommand,
    createPendingLedCommand,
    createPendingLedDeviceProjection,
} from './mock-bff-fixtures';
import { MockRoomScenario } from './mock-room-scenario';

const realtimeStreams = new Set<ServerResponse>();
const roomScenario = new MockRoomScenario();
let nextCommandId = 1;
let rejectNextCommand = false;
let publishAcceptedBeforeResponse = false;

const server = createServer((request, response) => {
    void handleRequest(request, response);
});

server.listen(browserTestRuntime.mockBffPort, browserTestRuntime.host, () => {
    process.stdout.write(`Mock BFF listening at ${browserTestUrls.mockBff}\n`);
});

process.once('SIGINT', stopServer);
process.once('SIGTERM', stopServer);

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    setCorsHeaders(response);

    if (request.method === 'OPTIONS') {
        response.writeHead(204).end();

        return;
    }

    if (request.method === 'GET' && request.url === mockBffPaths.health) {
        respondJson(response, 200, { status: 'ready' });

        return;
    }

    if (request.method === 'GET' && request.url === mockBffPaths.realtime) {
        openRealtimeStream(request, response);

        return;
    }

    if (request.method === 'POST' && request.url === mockBffPaths.reset) {
        roomScenario.reset();
        nextCommandId = 1;
        rejectNextCommand = false;
        publishAcceptedBeforeResponse = false;
        respondJson(response, 204, undefined);

        return;
    }

    if (request.method === 'PUT' && request.url === mockBffPaths.snapshot) {
        try {
            roomScenario.setSnapshot(parseJson(await readRequestBody(request)));
            respondJson(response, 204, undefined);
        } catch (error) {
            respondScenarioError(response, error);
        }

        return;
    }

    if (request.method === 'POST' && request.url === mockBffPaths.rejectNextCommand) {
        rejectNextCommand = true;
        respondJson(response, 204, undefined);

        return;
    }

    if (request.method === 'POST' && request.url === mockBffPaths.publishAcceptedBeforeResponse) {
        publishAcceptedBeforeResponse = true;
        respondJson(response, 204, undefined);

        return;
    }

    if (request.method === 'POST' && request.url === mockBffPaths.scenarioRealtime) {
        try {
            const message = roomScenario.applyUpdate(parseJson(await readRequestBody(request)));
            publishSseMessage(message);
            respondJson(response, 204, undefined);
        } catch (error) {
            respondScenarioError(response, error);
        }

        return;
    }

    if (request.method === 'POST' && request.url === mockBffPaths.disconnectRealtime) {
        closeRealtimeStreams();
        respondJson(response, 204, undefined);

        return;
    }

    if (request.method === 'POST' && request.url === mockBffPaths.commands) {
        try {
            parseMockSetPowerCommandRequest(await readRequestBody(request));
        } catch (error) {
            respondJson(response, 400, {
                message:
                    error instanceof Error
                        ? error.message
                        : 'Mock BFF command request was invalid.',
            });

            return;
        }

        const commandId = `mock-command-${nextCommandId++}`;

        if (rejectNextCommand) {
            rejectNextCommand = false;
            const failedCommand = createFailedLedCommand(commandId);
            const update = roomScenario.applyUpdate(
                createCommandsUpdatedMessage(roomScenario.currentRevision(), {
                    recentCommands: [failedCommand],
                }),
            );
            publishSseMessage(update);
            respondJson(
                response,
                409,
                assertMockRejectedCommandResponse({
                    commandId: failedCommand.commandId,
                    status: 'rejected',
                    reason: failedCommand.reason,
                    message: failedCommand.message,
                    durability: failedCommand.durability,
                    lifecycleDurability: failedCommand.lifecycleDurability,
                }),
            );

            return;
        }

        if (publishAcceptedBeforeResponse) {
            publishAcceptedBeforeResponse = false;
            const update = roomScenario.applyUpdate(
                createCommandsUpdatedMessage(roomScenario.currentRevision(), {
                    devices: [createPendingLedDeviceProjection()],
                    activeCommands: [createPendingLedCommand()],
                }),
            );
            publishSseMessage(update);
        }

        respondJson(response, 202, {
            commandId,
            status: 'accepted',
            durability: 'durable',
            lifecycleDurability: 'durable',
        });

        return;
    }

    respondJson(response, 404, { message: 'Mock BFF route not found.' });
}

function setCorsHeaders(response: ServerResponse): void {
    response.setHeader('access-control-allow-origin', browserTestUrls.frontend);
    response.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type');
}

function openRealtimeStream(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
    });
    response.flushHeaders();
    realtimeStreams.add(response);
    response.write(serializeMockSseMessage(roomScenario.snapshotMessage()));

    request.on('close', () => {
        realtimeStreams.delete(response);
        response.end();
    });
}

function publishSseMessage(message: unknown): void {
    const serializedMessage = serializeMockSseMessage(message);

    for (const response of realtimeStreams) {
        response.write(serializedMessage);
    }
}

function closeRealtimeStreams(): void {
    for (const response of realtimeStreams) {
        response.end();
    }
}

function parseJson(body: string): unknown {
    try {
        return JSON.parse(body);
    } catch {
        throw new Error('Mock BFF scenario request body was not valid JSON.');
    }
}

function respondScenarioError(response: ServerResponse, error: unknown): void {
    respondJson(response, 400, {
        message: error instanceof Error ? error.message : 'Mock BFF scenario request was invalid.',
    });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString('utf8');
}

function respondJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.writeHead(statusCode, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
}

function stopServer(): void {
    closeRealtimeStreams();

    server.close(() => {
        process.exit(0);
    });
}
