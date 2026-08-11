import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { parseMockSetPowerCommandRequest, serializeMockSseMessage } from './mock-bff-contracts';
import { MockRoomScenario } from './mock-room-scenario';

const host = '127.0.0.1';
const port = 4311;
const frontendOrigin = 'http://127.0.0.1:5174';
const realtimeStreams = new Set<ServerResponse>();
const roomScenario = new MockRoomScenario();
let nextCommandId = 1;

const server = createServer((request, response) => {
    void handleRequest(request, response);
});

server.listen(port, host, () => {
    process.stdout.write(`Mock BFF listening at http://${host}:${port}\n`);
});

process.once('SIGINT', stopServer);
process.once('SIGTERM', stopServer);

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    setCorsHeaders(response);

    if (request.method === 'OPTIONS') {
        response.writeHead(204).end();

        return;
    }

    if (request.method === 'GET' && request.url === '/health') {
        respondJson(response, 200, { status: 'ready' });

        return;
    }

    if (request.method === 'GET' && request.url === '/room/realtime') {
        openRealtimeStream(request, response);

        return;
    }

    if (request.method === 'POST' && request.url === '/test/room/reset') {
        roomScenario.reset();
        respondJson(response, 204, undefined);

        return;
    }

    if (request.method === 'PUT' && request.url === '/test/room/snapshot') {
        try {
            roomScenario.setSnapshot(parseJson(await readRequestBody(request)));
            respondJson(response, 204, undefined);
        } catch (error) {
            respondScenarioError(response, error);
        }

        return;
    }

    if (request.method === 'POST' && request.url === '/test/room/realtime') {
        try {
            const message = roomScenario.applyUpdate(parseJson(await readRequestBody(request)));
            publishSseMessage(message);
            respondJson(response, 204, undefined);
        } catch (error) {
            respondScenarioError(response, error);
        }

        return;
    }

    if (request.method === 'POST' && request.url === '/room/commands') {
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

        respondJson(response, 202, {
            commandId: `mock-command-${nextCommandId++}`,
            status: 'accepted',
        });

        return;
    }

    respondJson(response, 404, { message: 'Mock BFF route not found.' });
}

function setCorsHeaders(response: ServerResponse): void {
    response.setHeader('access-control-allow-origin', frontendOrigin);
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
    for (const response of realtimeStreams) {
        response.end();
    }

    server.close(() => {
        process.exit(0);
    });
}
