import { type ChildProcess, spawn } from 'node:child_process';

import { browserTestRuntime, browserTestUrls, mockBffUrls } from '../browser-test-runtime';

const readinessTimeoutMs = 30_000;

export default async function startBrowserTestRuntime(): Promise<() => Promise<void>> {
    const mockBff = startProcess([
        './node_modules/tsx/dist/cli.mjs',
        'frontend/tests/browser-integration/mock-bff/mock-bff.ts',
    ]);
    let frontend: ChildProcess | undefined;

    try {
        await waitForReady(mockBffUrls.health);

        const startedFrontend = startProcess(
            [
                './node_modules/vite/bin/vite.js',
                'frontend',
                '--config',
                'frontend/vite.config.ts',
                '--host',
                browserTestRuntime.host,
                '--port',
                String(browserTestRuntime.frontendPort),
                '--strictPort',
            ],
            {
                VITE_ROOM_COMMAND_URL: mockBffUrls.commands,
                VITE_ROOM_REALTIME_URL: mockBffUrls.realtime,
            },
        );
        frontend = startedFrontend;

        await waitForReady(browserTestUrls.frontend);

        return async () => {
            await Promise.all([stopProcess(startedFrontend), stopProcess(mockBff)]);
        };
    } catch (error) {
        if (frontend) {
            await stopProcess(frontend);
        }

        await stopProcess(mockBff);

        throw error;
    }
}

function startProcess(
    arguments_: string[],
    environment: Record<string, string> = {},
): ChildProcess {
    return spawn(process.execPath, arguments_, {
        cwd: process.cwd(),
        env: { ...process.env, ...environment },
        stdio: 'inherit',
    });
}

async function waitForReady(url: string): Promise<void> {
    const deadline = Date.now() + readinessTimeoutMs;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);

            if (response.ok) {
                return;
            }
        } catch {
            // The process may still be binding its dedicated test port.
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Timed out waiting for ${url}.`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null) {
        return;
    }

    const exited = new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
    });

    child.kill();
    await exited;
}
