import { describe, expect, it } from 'vitest';
import { createFixtureRealtimeClient } from './fixture-realtime-client';

describe('createFixtureRealtimeClient', () => {
    it('returns an initial room snapshot without opening a WebSocket', () => {
        const client = createFixtureRealtimeClient();
        const snapshot = client.getInitialSnapshot();

        expect(snapshot.roomName).toBe('Local Smart Room');
        expect(snapshot.connectionStatus).toBe('fixture');
        expect(snapshot.devices.some((device) => device.deviceId === 'led-main')).toBe(true);
    });
});
