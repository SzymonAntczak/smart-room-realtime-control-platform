import { createRoomBffServer } from './api/room-bff';
import { isDevScenarioControlsEnabled } from './api/dev-scenario-controls';
import { createTemperatureRoomRuntime } from './runtime/temperature-room-runtime';
import { readDeduplicationRuntimeConfig } from './runtime/deduplication-runtime-config';

const defaultPort = 4310;
const port = readPort(process.env.PORT);
const runtime = createTemperatureRoomRuntime(readDeduplicationRuntimeConfig(process.env));
const enableDevScenarioControls = isDevScenarioControlsEnabled(process.env.ENABLE_DEV_SCENARIOS);
const server = createRoomBffServer({
    getRoomSnapshot: runtime.getRoomSnapshot,
    getDiagnosticsSnapshot: runtime.getDiagnosticsSnapshot,
    subscribeRoomSnapshot: runtime.subscribeRoomSnapshot,
    runScenario: enableDevScenarioControls ? runtime.runScenario : undefined,
});

runtime.start();

server.listen(port, () => {
    console.log(`Smart Room BFF listening on http://localhost:${port}`);
});

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
