import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { createWalkthroughSseProxy } from './walkthrough-sse-proxy.mjs';

test(
    'forwards SSE until dropped and only opens a new upstream stream after resume',
    { timeout: 5000 },
    async (t) => {
        let upstreamConnections = 0;
        const upstream = createServer((request, response) => {
            assert.equal(request.url, '/room/realtime');
            upstreamConnections += 1;
            response.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Access-Control-Allow-Origin': '*',
            });
            response.write(`data: ${upstreamConnections}\n\n`);
        });
        const upstreamUrl = new URL('/room/realtime', await listen(upstream, t));
        const proxy = createWalkthroughSseProxy(upstreamUrl);
        const proxyUrl = await listen(proxy.server, t);
        const realtimeUrl = `${proxyUrl}/room/realtime`;

        const otherRoute = await fetch(`${proxyUrl}/room`);
        assert.equal(otherRoute.status, 404);
        await otherRoute.arrayBuffer();
        assert.equal(upstreamConnections, 0);

        const originalStream = await fetch(realtimeUrl);
        assert.equal(originalStream.status, 200);
        assert.equal(originalStream.headers.get('content-type'), 'text/event-stream');
        assert.equal(originalStream.headers.get('access-control-allow-origin'), '*');
        const originalReader = originalStream.body.getReader();
        assert.equal(await readFrame(originalReader), 'data: 1\n\n');

        proxy.drop();
        await assert.rejects(originalReader.read());
        await assert.rejects(fetch(realtimeUrl));
        assert.equal(upstreamConnections, 1);

        proxy.resume();
        const resumedStream = await fetch(realtimeUrl);
        const resumedReader = resumedStream.body.getReader();
        assert.equal(await readFrame(resumedReader), 'data: 2\n\n');
        await resumedReader.cancel();
    },
);

async function listen(server, t) {
    server.listen(0, '127.0.0.1');
    t.after(() => {
        server.close();
        server.closeAllConnections();
    });
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
}

async function readFrame(reader) {
    let frame = '';
    const decoder = new TextDecoder();

    while (!frame.endsWith('\n\n')) {
        const { done, value } = await reader.read();
        assert.equal(done, false);
        frame += decoder.decode(value, { stream: true });
    }

    return frame;
}
