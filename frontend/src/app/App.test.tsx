import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

describe('App', () => {
    beforeEach(() => {
        MockWebSocket.instances.length = 0;
        vi.stubGlobal('WebSocket', MockWebSocket);
    });

    afterEach(() => vi.unstubAllGlobals());

    it('waits for a realtime snapshot before rendering device controls', () => {
        render(<App />);

        expect(screen.getByText('Connecting to realtime room stream...')).toBeInTheDocument();
    });

    it('does not render development scenario controls', () => {
        render(<App />);

        expect(screen.queryByText('Dev scenarios')).not.toBeInTheDocument();
    });

    it('renders supported device cards from one room snapshot and maps LED commands by device', () => {
        render(<App />);
        act(() => MockWebSocket.latest().emitMessage(createRoomSnapshotMessage()));

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Main LED' })).toBeInTheDocument();
        expect(screen.getByText(/Requested: On/)).toBeInTheDocument();
        expect(screen.queryByText('Dev scenarios')).not.toBeInTheDocument();
    });

    it('keeps the temperature view visible and marks it uncertain while reconnecting', () => {
        render(<App />);
        act(() =>
            MockWebSocket.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [temperatureDevice()], activeCommands: [] }),
            ),
        );
        act(() => MockWebSocket.latest().emitClose());

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(
            screen.getByText(
                'Realtime stream is reconnecting. Showing the last valid temperature update.',
            ),
        ).toBeInTheDocument();
    });

    it('omits unsupported device roles from the current control view', () => {
        render(<App />);
        act(() =>
            MockWebSocket.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [humidityDevice()], activeCommands: [] }),
            ),
        );

        expect(screen.queryByRole('heading', { name: 'Humidity sensor' })).not.toBeInTheDocument();
        expect(screen.queryByText('Connecting to realtime room stream...')).not.toBeInTheDocument();
    });
});

class MockWebSocket extends EventTarget {
    static instances: MockWebSocket[] = [];

    constructor() {
        super();
        MockWebSocket.instances.push(this);
    }

    static latest(): MockWebSocket {
        const instance = MockWebSocket.instances.at(-1);

        if (!instance) {
            throw new Error('No mock websocket instance was created.');
        }

        return instance;
    }

    close(): void {
        this.dispatchEvent(new Event('close'));
    }

    emitClose(): void {
        this.dispatchEvent(new Event('close'));
    }

    emitMessage(data: unknown): void {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
}

function createRoomSnapshotMessage({
    devices = [temperatureDevice(), ledDevice()],
    activeCommands = [pendingCommand()],
}: {
    devices?: unknown[];
    activeCommands?: unknown[];
} = {}) {
    return {
        messageType: 'room.snapshot',
        revision: 0,
        sentAt: '2026-06-08T09:30:01Z',
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-06-08T09:30:00Z',
            devices,
            activeCommands,
            recentCommands: [],
        },
    };
}

function pendingCommand() {
    return {
        commandId: 'cmd-1',
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'pending',
        requestedState: { power: 'on' },
        requestedAt: '2026-06-08T09:30:00Z',
        dispatchedAt: '2026-06-08T09:30:01Z',
    };
}

function temperatureDevice() {
    return {
        deviceId: 'temp-desk',
        name: 'Desk Temperature',
        role: 'temperature-sensor',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        reportedState: { temperature: 22.4, temperatureUnit: 'celsius' },
        commandAvailability: { policy: 'block', reason: 'read_only_device' },
        observationStatus: {
            temperature: { freshness: 'fresh', lastObservedAt: '2026-06-08T09:30:00Z' },
        },
    };
}

function ledDevice() {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        reportedState: { power: 'off' },
        commandAvailability: { policy: 'allow' },
        activeCommandId: 'cmd-1',
        observationStatus: {
            power: { freshness: 'fresh', lastObservedAt: '2026-06-08T09:30:00Z' },
        },
    };
}

function humidityDevice() {
    return {
        deviceId: 'humidity-desk',
        name: 'Humidity sensor',
        role: 'humidity-sensor',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        reportedState: { humidity: 48 },
        commandAvailability: { policy: 'block', reason: 'read_only_device' },
        observationStatus: {
            humidity: { freshness: 'fresh', lastObservedAt: '2026-06-08T09:30:00Z' },
        },
    };
}
