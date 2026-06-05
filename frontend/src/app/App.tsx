import { useEffect, useState } from 'react';
import { RoomDashboard } from './room-control/RoomDashboard';
import { createSetPowerCommandRequest } from './room-control/room-view-model';
import { createBackendRealtimeClient } from './room-realtime/backend-realtime-client';
import { createFixtureRealtimeClient } from './room-realtime/fixture-realtime-client';
import type { RealtimeClient } from './room-realtime/realtime-client';
import type { RoomSnapshotView } from './room-control/room-view-model';

const realtimeClient = createDefaultRealtimeClient();

interface AppProps {
    client?: RealtimeClient;
}

export function App({ client = realtimeClient }: AppProps) {
    const [snapshot, setSnapshot] = useState<RoomSnapshotView>(() => client.getInitialSnapshot());

    useEffect(() => {
        return client.subscribe(setSnapshot);
    }, [client]);

    return (
        <RoomDashboard
            snapshot={snapshot}
            onLedPowerRequest={(power) =>
                client.sendCommand(createSetPowerCommandRequest('led-main', power))
            }
        />
    );
}

function createDefaultRealtimeClient() {
    if (import.meta.env.VITE_REALTIME_MODE === 'fixture') {
        return createFixtureRealtimeClient();
    }

    return createBackendRealtimeClient(
        import.meta.env.VITE_REALTIME_URL ?? 'ws://localhost:8787/realtime',
    );
}
