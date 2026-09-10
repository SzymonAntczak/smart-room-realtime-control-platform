import type { FastifyInstance } from 'fastify';
import pino, { type DestinationStream, type Logger } from 'pino';

import { isDevScenarioControlsEnabled } from '../api/dev-scenario-controls';
import { createRoomBffServer } from '../api/room-bff';

import { readDeduplicationRuntimeConfig } from './deduplication-runtime-config';
import { type BackendLogLevel, readLoggingRuntimeConfig } from './logging-runtime-config';
import { resolveStorageRuntimeComposition } from './storage-runtime-composition';
import {
    createTemperatureRoomRuntime,
    type TemperatureRoomRuntime,
} from './temperature-room-runtime';

const defaultPort = 4310;

export interface BackendInstance {
    logger: Logger;
    port: number;
    runtime: TemperatureRoomRuntime;
    server: FastifyInstance;
}

export interface BackendBootstrapConfig {
    environment?: NodeJS.ProcessEnv;
    argv?: readonly string[];
    logger?: Logger;
    port?: number;
}

export interface RunBackendConfig extends BackendBootstrapConfig {
    onStartupFailure?: (error: unknown) => void;
}

export function createBackendLogger(
    logLevel: BackendLogLevel,
    destination?: DestinationStream,
): Logger {
    return destination ? pino({ level: logLevel }, destination) : pino({ level: logLevel });
}

export function createBackend({
    environment = process.env,
    argv = process.argv.slice(2),
    logger,
    port,
}: BackendBootstrapConfig = {}): BackendInstance {
    const resolvedLogger =
        logger ?? createBackendLogger(readLoggingRuntimeConfig(environment).logLevel);
    const resolvedPort = port ?? readPort(environment.PORT);

    const operationalLog = (entry: Record<string, unknown>) => {
        resolvedLogger.info(entry);
    };

    const runtime = createTemperatureRoomRuntime({
        ...readDeduplicationRuntimeConfig(environment),
        ...resolveStorageRuntimeComposition({
            environment,
            argv,
            operationalLog,
        }),
        operationalLog,
    });
    const enableDevScenarioControls = isDevScenarioControlsEnabled(
        environment.ENABLE_DEV_SCENARIOS,
    );
    const server = createRoomBffServer({
        getRoomSnapshot: runtime.getRoomSnapshot,
        getDiagnosticsSnapshot: runtime.getDiagnosticsSnapshot,
        subscribeRoomPublicationBatch: runtime.subscribeRoomPublicationBatch,
        requestCommand: runtime.requestCommand,
        runDeviceScenario: enableDevScenarioControls ? runtime.runDeviceScenario : undefined,
        getDeviceScenarios: enableDevScenarioControls ? runtime.getDeviceScenarios : undefined,
        loggerInstance: resolvedLogger,
    });

    return { logger: resolvedLogger, port: resolvedPort, runtime, server };
}

export async function startBackend(config: BackendBootstrapConfig = {}): Promise<BackendInstance> {
    const backend = createBackend(config);

    backend.runtime.start();

    try {
        await backend.server.listen({ port: backend.port });
    } catch (error) {
        backend.runtime.stop();

        throw error;
    }

    backend.logger.info({
        event: 'backend_started',
        source: 'backend',
        port: readListeningPort(backend.server, backend.port),
    });

    return backend;
}

export async function runBackend({
    environment = process.env,
    argv = process.argv.slice(2),
    logger,
    port,
    onStartupFailure,
}: RunBackendConfig = {}): Promise<BackendInstance | undefined> {
    let resolvedLogger = logger;

    try {
        const { logLevel } = readLoggingRuntimeConfig(environment);
        resolvedLogger ??= createBackendLogger(logLevel);

        return await startBackend({ environment, argv, logger: resolvedLogger, port });
    } catch (error) {
        const failureLogger = resolvedLogger ?? createBackendLogger('info');

        failureLogger.fatal({ event: 'backend_startup_failed', source: 'backend', err: error });

        if (onStartupFailure) {
            onStartupFailure(error);
        } else {
            process.exitCode = 1;
        }

        return undefined;
    }
}

export function readPort(value: string | undefined): number {
    if (value === undefined) {
        return defaultPort;
    }

    const parsedPort = Number(value);

    if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
        throw new RangeError('PORT must be a positive integer.');
    }

    return parsedPort;
}

function readListeningPort(server: FastifyInstance, fallback: number): number {
    const address = server.server.address();

    return typeof address === 'object' && address !== null ? address.port : fallback;
}
