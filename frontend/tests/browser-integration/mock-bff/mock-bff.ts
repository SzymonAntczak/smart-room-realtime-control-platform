import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const host = '127.0.0.1';
const port = 4311;
const frontendOrigin = 'http://127.0.0.1:5174';
const realtimeStreams = new Set<ServerResponse>();
let nextCommandId = 1;

const server = createServer((request, response) => {
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

    if (request.method === 'POST' && request.url === '/room/commands') {
        request.resume();
        respondJson(response, 202, {
            commandId: `mock-command-${nextCommandId++}`,
            status: 'accepted',
        });

        return;
    }

    respondJson(response, 404, { message: 'Mock BFF route not found.' });
});

server.listen(port, host, () => {
    process.stdout.write(`Mock BFF listening at http://${host}:${port}\n`);
});

process.once('SIGINT', stopServer);
process.once('SIGTERM', stopServer);

function setCorsHeaders(response: ServerResponse): void {
    response.setHeader('access-control-allow-origin', frontendOrigin);
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
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

    request.on('close', () => {
        realtimeStreams.delete(response);
        response.end();
    });
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
