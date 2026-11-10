import { createServer, get } from 'node:http';
import { createInterface } from 'node:readline';

const realtimePath = '/room/realtime';

export function createWalkthroughSseProxy(upstreamUrl) {
    let paused = false;
    const streams = new Set();
    const server = createServer((request, response) => {
        if (request.method !== 'GET' || request.url !== realtimePath) {
            response.writeHead(404).end();
            return;
        }

        if (paused) {
            response.destroy();
            return;
        }

        const headers = { ...request.headers, host: upstreamUrl.host };
        const upstream = get(upstreamUrl, { headers }, (upstreamResponse) => {
            upstreamResponse.on('error', () => response.destroy());
            response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
            upstreamResponse.pipe(response);
        });

        streams.add(response);
        response.on('close', () => {
            streams.delete(response);
            upstream.destroy();
        });
        upstream.on('error', () => response.destroy());
    });

    return {
        server,
        drop() {
            paused = true;
            for (const stream of streams) {
                stream.destroy();
            }
        },
        resume() {
            paused = false;
        },
    };
}

if (import.meta.main) {
    const upstreamUrl = new URL(realtimePath, 'http://localhost:4310');
    const proxy = createWalkthroughSseProxy(upstreamUrl);
    const controls = createInterface({ input: process.stdin });

    controls.on('line', (line) => {
        switch (line.trim()) {
            case 'drop':
                proxy.drop();
                console.log('SSE paused. Type resume to allow new connections.');
                break;
            case 'resume':
                proxy.resume();
                console.log('SSE resumed.');
                break;
            default:
                console.log('Type drop or resume.');
        }
    });
    controls.on('close', () => {
        proxy.server.close();
        proxy.server.closeAllConnections();
    });
    proxy.server.listen(4311, '127.0.0.1', () => {
        console.log(`SSE proxy listening on http://127.0.0.1:4311${realtimePath}`);
        console.log('Type drop or resume. Press Ctrl+C to stop.');
    });
}
