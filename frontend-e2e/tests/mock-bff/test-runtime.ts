import { type ChildProcess, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { FullConfig } from '@playwright/test';

import { browserTestRuntime, browserTestUrls, mockBffUrls } from '../browser-test-runtime';

const readinessTimeoutMs = 30_000;
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);

export default async function startBrowserTestRuntime(
    config: FullConfig,
): Promise<() => Promise<void>> {
    const compilerEnabled = config.metadata['reactCompiler'] === true;
    const mockBff = startProcess([
        '--import',
        pathToFileURL(require.resolve('tsx')).href,
        fileURLToPath(new URL('./mock-bff.ts', import.meta.url)),
    ]);
    let frontend: ChildProcess | undefined;

    try {
        await waitForReady(mockBffUrls.health);

        const startedFrontend = startProcess(
            [
                join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'),
                'frontend',
                '--config',
                compilerEnabled
                    ? 'frontend-e2e/vite.compiler.config.ts'
                    : 'frontend/vite.config.ts',
                '--host',
                browserTestRuntime.host,
                '--port',
                String(browserTestRuntime.frontendPort),
                '--strictPort',
            ],
            {
                VITE_BFF_URL: browserTestUrls.mockBff,
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
        cwd: repositoryRoot,
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
