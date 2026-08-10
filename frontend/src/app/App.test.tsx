import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

describe('App', () => {
    beforeEach(() => {
        MockWebSocket.instances.length = 0;
        vi.stubGlobal('EventSource', MockWebSocket);
    });

    afterEach(() => vi.unstubAllGlobals());

    it('waits for a realtime snapshot before rendering device controls', () => {
        render(<App />);

        expect(
            screen.getByText('Łączenie ze strumieniem pokoju w czasie rzeczywistym…'),
        ).toBeInTheDocument();
    });

    it('does not render development scenario controls', () => {
        render(<App />);

        expect(screen.queryByText('Scenariusze programistyczne')).not.toBeInTheDocument();
    });

    it('renders supported device cards from one room snapshot and maps LED commands by device', () => {
        render(<App />);
        act(() => MockWebSocket.latest().emitMessage(createRoomSnapshotMessage()));

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Main LED' })).toBeInTheDocument();
        expect(screen.getByText(/Zażądano: Włączone/)).toBeInTheDocument();
        expect(screen.queryByText('Scenariusze programistyczne')).not.toBeInTheDocument();
    });

    it('keeps the temperature view visible and marks it uncertain while reconnecting', () => {
        render(<App />);
        act(() =>
            MockWebSocket.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [temperatureDevice()], activeCommands: [] }),
            ),
        );
        act(() => MockWebSocket.latest().emitError());

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(
            screen.getByText(
                'Strumień czasu rzeczywistego ponownie się łączy. Wyświetlany jest ostatni prawidłowy odczyt temperatury.',
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
        expect(
            screen.queryByText('Łączenie ze strumieniem pokoju w czasie rzeczywistym…'),
        ).not.toBeInTheDocument();
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

    emitError(): void {
        this.dispatchEvent(new Event('error'));
    }

    emitMessage(data: unknown, eventType = getRealtimeEventType(data)): void {
        this.dispatchEvent(new MessageEvent(eventType, { data: JSON.stringify(data) }));
    }
}

function getRealtimeEventType(data: unknown): string {
    if (typeof data === 'object' && data !== null && 'messageType' in data) {
        const messageType = data.messageType;

        if (typeof messageType === 'string') {
            return messageType;
        }
    }

    return 'room.snapshot';
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
