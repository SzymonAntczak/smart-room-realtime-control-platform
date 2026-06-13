import { createRoomBffServer } from './api/room-bff';
import { createTemperatureRoomRuntime } from './runtime/temperature-room-runtime';

const defaultPort = 4310;
const port = readPort(process.env.PORT);
const runtime = createTemperatureRoomRuntime();
const server = createRoomBffServer({
    getRoomSnapshot: runtime.getRoomSnapshot,
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
