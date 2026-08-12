import type { FastifyReply } from 'fastify';

export function setCorsHeaders(response: FastifyReply): void {
    response.header('Access-Control-Allow-Origin', '*');
    response.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.header('Access-Control-Allow-Headers', 'Content-Type');
}

export function writeJson(response: FastifyReply, statusCode: number, body: unknown): void {
    void response
        .code(statusCode)
        .type('application/json')
        .send(body as Record<string, unknown>);
}

export function writeInvalidServerResponse(response: FastifyReply): void {
    writeJson(response, 500, {
        error: 'invalid_server_response',
        message: 'Server produced a response that does not match the transport contract.',
    });
}

export function isJsonMediaType(contentType: string | undefined): boolean {
    return contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}
