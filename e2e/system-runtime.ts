import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { deviceScenarioListSchema } from '@smart-room/contracts/development';
import { isRoomBffSnapshot } from '@smart-room/contracts/room-bff';
import { isSchema } from '@smart-room/contracts/validation';

import { smokePorts, smokeUrls } from './smoke-urls';

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export default async function startSystem(): Promise<() => Promise<void>> {
    await checkPort('localhost', smokePorts.bff);
    await checkPort('127.0.0.1', smokePorts.bff);
    await checkPort('127.0.0.1', smokePorts.frontend);

    const directory = await mkdtemp(join(tmpdir(), 'smart-room-e2e-'));
    const processes: RunningProcess[] = [];

    async function cleanup() {
        await Promise.all(processes.map(stopProcess));
        await rm(directory, { recursive: true, force: true });
    }

    try {
        const backend = startProcess(
            'BFF',
            ['--import', pathToFileURL(require.resolve('tsx')).href, 'backend/src/server.ts'],
            {
                PORT: String(smokePorts.bff),
                LOG_LEVEL: 'warn',
                ENABLE_DEV_SCENARIOS: 'true',
                SMART_ROOM_STORAGE_PATH: join(directory, 'smart-room.sqlite'),
            },
        );
        processes.push(backend);
        await waitForReady(backend, `${smokeUrls.bff}/room`, async (response) => {
            const snapshot: unknown = await response.json();

            return (
                isRoomBffSnapshot(snapshot) &&
                snapshot.platform.storage.status === 'available' &&
                ['temp-desk', 'temp-window', 'led-main'].every((id) =>
                    snapshot.devices.some((device) => device.deviceId === id),
                )
            );
        });
        await waitForReady(
            backend,
            `${smokeUrls.bff}/dev/devices/temp-desk/scenarios`,
            async (response) => {
                const scenarios: unknown = await response.json();

                return (
                    isSchema(deviceScenarioListSchema, scenarios) &&
                    scenarios.deviceId === 'temp-desk' &&
                    scenarios.scenarios.some(({ action }) => action === 'degrade_device') &&
                    scenarios.scenarios.some(({ action }) => action === 'recover_device')
                );
            },
        );

        const frontend = startProcess(
            'Vite',
            [
                join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'),
                'frontend',
                '--config',
                'frontend/vite.config.ts',
                '--host',
                '127.0.0.1',
                '--port',
                String(smokePorts.frontend),
                '--strictPort',
            ],
            {
                VITE_BFF_URL: smokeUrls.bff,
                VITE_ROOM_COMMAND_URL: `${smokeUrls.bff}/room/commands`,
                VITE_ROOM_REALTIME_URL: `${smokeUrls.bff}/room/realtime`,
            },
        );
        processes.push(frontend);
        await waitForReady(frontend, smokeUrls.frontend, async (response) =>
            (await response.text()).includes('/@vite/client'),
        );
        assertRunning(backend);

        return cleanup;
    } catch (error) {
        await cleanup();

        throw error;
    }
}

function checkPort(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once('error', (cause) =>
            reject(new Error(`Smoke E2E cannot bind ${host}:${port}. ${cause.message}`, { cause })),
        );
        probe.listen(port, host, () => probe.close((error) => (error ? reject(error) : resolve())));
    });
}

interface RunningProcess {
    name: string;
    child: ChildProcess;
    closed: Promise<void>;
    failure?: string;
}

function startProcess(
    name: string,
    args: readonly string[],
    environment: Record<string, string>,
): RunningProcess {
    const child = spawn(process.execPath, args, {
        cwd: repositoryRoot,
        env: { ...process.env, ...environment },
        stdio: 'inherit',
        windowsHide: true,
    });
    const running: RunningProcess = {
        name,
        child,
        closed: new Promise((resolve) => child.once('close', () => resolve())),
    };
    child.once('error', (error) => {
        running.failure = error.message;
    });
    child.once('exit', (code, signal) => {
        running.failure = signal ?? `exit code ${code}`;
    });

    return running;
}

function assertRunning(process: RunningProcess) {
    if (process.failure) {
        throw new Error(`${process.name} exited before smoke readiness: ${process.failure}`);
    }
}

async function waitForReady(
    process: RunningProcess,
    url: string,
    isReady: (response: Response) => Promise<boolean>,
) {
    const deadline = Date.now() + 30_000;
    let lastResult = 'no response';

    while (Date.now() < deadline) {
        assertRunning(process);

        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });

            if (response.ok && (await isReady(response))) {
                return;
            }

            lastResult = `HTTP ${response.status} did not meet the readiness check`;

            if (!response.bodyUsed) {
                await response.body?.cancel();
            }
        } catch (error) {
            lastResult =
                error instanceof Error && error.cause ? String(error.cause) : String(error);
        }

        await delay(100);
    }

    assertRunning(process);

    throw new Error(`Timed out waiting for ${process.name} readiness at ${url}. ${lastResult}`);
}

async function stopProcess({ child, closed }: RunningProcess) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
        child.kill();
    }

    await closed;
}
