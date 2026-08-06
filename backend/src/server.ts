import { isDevScenarioControlsEnabled } from './api/dev-scenario-controls';
import { createRoomBffServer } from './api/room-bff';
import { readDeduplicationRuntimeConfig } from './runtime/deduplication-runtime-config';
import { createTemperatureRoomRuntime } from './runtime/temperature-room-runtime';

const defaultPort = 4310;
const port = readPort(process.env.PORT);
const runtime = createTemperatureRoomRuntime(readDeduplicationRuntimeConfig(process.env));
const enableDevScenarioControls = isDevScenarioControlsEnabled(process.env.ENABLE_DEV_SCENARIOS);
const server = createRoomBffServer({
    getRoomSnapshot: runtime.getRoomSnapshot,
    getDiagnosticsSnapshot: runtime.getDiagnosticsSnapshot,
    subscribeRoomSnapshot: runtime.subscribeRoomSnapshot,
    requestCommand: runtime.requestCommand,
    runDeviceScenario: enableDevScenarioControls ? runtime.runDeviceScenario : undefined,
    getDeviceScenarios: enableDevScenarioControls ? runtime.getDeviceScenarios : undefined,
});

await startServer();

async function startServer(): Promise<void> {
    runtime.start();

    try {
        await server.listen({ port });
    } catch (error) {
        runtime.stop();
        throw error;
    }

    console.log(`Smart Room BFF listening on http://localhost:${port}`);
}

function readPort(value: string | undefined): number {
    if (value === undefined) {
        return defaultPort;
    }

    const parsedPort = Number(value);

    if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
        throw new RangeError('PORT must be a positive integer.');
    }

    return parsedPort;
}
