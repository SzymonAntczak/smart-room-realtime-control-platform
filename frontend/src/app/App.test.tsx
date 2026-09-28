import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

        expect(screen.getByRole('heading', { name: 'Temperatura biurka' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Temperatura okna' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Główne LED' })).toBeInTheDocument();
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

        expect(screen.getByRole('heading', { name: 'Temperatura biurka' })).toBeInTheDocument();
        expect(
            screen.getByText(
                'Strumień czasu rzeczywistego ponownie się łączy. Wyświetlany jest ostatni prawidłowy odczyt temperatury.',
            ),
        ).toBeInTheDocument();
    });

    it('renders the bounded snapshot feed and marks it last known while reconnecting', () => {
        render(<App />);
        act(() =>
            MockWebSocket.latest().emitMessage(
                createRoomSnapshotMessage({
                    recentEvents: [
                        {
                            recordId: `rec:v1:sha256:${'a'.repeat(64)}`,
                            occurredAt: '2026-06-08T09:30:00.000Z',
                            durability: 'volatile',
                            source: 'backend',
                            deviceId: 'led-main',
                            commandId: 'cmd-1',
                            eventType: 'command.requested',
                            payload: {
                                commandType: 'set.power',
                                requestedState: { power: 'on' },
                                requestedBy: 'user',
                            },
                        },
                    ],
                }),
            ),
        );

        expect(
            screen.getByRole('region', { name: 'Ostatnie istotne zdarzenia' }),
        ).toHaveTextContent('Zażądano zasilania: Włączone.');
        act(() => MockWebSocket.latest().emitError());
        expect(screen.getByText(/Wyświetlane są ostatnio znane zdarzenia/)).toBeInTheDocument();
    });

    it('adds a feed fact from a contiguous device update', () => {
        render(<App />);
        act(() => MockWebSocket.latest().emitMessage(createRoomSnapshotMessage()));

        const feed = screen.getByRole('region', { name: 'Ostatnie istotne zdarzenia' });
        expect(feed).toHaveTextContent('Brak istotnych zdarzeń.');

        act(() =>
            MockWebSocket.latest().emitMessage({
                messageType: 'device.updated',
                previousRevision: 0,
                revision: 1,
                sentAt: '2026-06-08T09:30:02Z',
                payload: ledDevice(),
                recentEvents: [
                    {
                        recordId: `rec:v1:sha256:${'b'.repeat(64)}`,
                        occurredAt: '2026-06-08T09:30:02.000Z',
                        durability: 'volatile',
                        source: 'backend',
                        deviceId: 'led-main',
                        commandId: 'cmd-1',
                        eventType: 'command.dispatched',
                        payload: { commandType: 'set.power', target: 'simulator-adapter' },
                    },
                ],
            }),
        );

        expect(feed).toHaveTextContent('Polecenie wysłano do źródła urządzenia.');
        expect(feed).toHaveTextContent('Główne LED');
    });

    it('keeps live telemetry out of the significant-events feed', () => {
        const { telemetrySample } = createHistoryIdentityFixtures();
        render(<App />);
        act(() => MockWebSocket.latest().emitMessage(createRoomSnapshotMessage()));

        const feed = screen.getByRole('region', { name: 'Ostatnie istotne zdarzenia' });
        expect(feed).toHaveTextContent('Brak istotnych zdarzeń.');

        act(() =>
            MockWebSocket.latest().emitMessage({
                messageType: 'device.updated',
                previousRevision: 0,
                revision: 1,
                sentAt: '2026-09-10T10:00:01Z',
                payload: temperatureDevice(),
                telemetrySample,
            }),
        );

        expect(feed).toHaveTextContent('Brak istotnych zdarzeń.');
        expect(within(feed).queryByRole('listitem')).not.toBeInTheDocument();
        expect(
            screen.queryByText(/Wyświetlane są ostatnio znane zdarzenia/),
        ).not.toBeInTheDocument();
    });

    it('keeps accepted non-applying facts out of the feed when only the watermark advances', () => {
        render(<App />);
        act(() => MockWebSocket.latest().emitMessage(createRoomSnapshotMessage()));

        const feed = screen.getByRole('region', { name: 'Ostatnie istotne zdarzenia' });
        act(() =>
            MockWebSocket.latest().emitMessage({
                messageType: 'platform.updated',
                previousRevision: 0,
                revision: 1,
                sentAt: '2026-09-10T10:00:01Z',
                payload: {
                    storage: { ...availableStorage(), storedThroughSequence: 1 },
                },
            }),
        );

        expect(feed).toHaveTextContent('Brak istotnych zdarzeń.');
        expect(within(feed).queryByRole('listitem')).not.toBeInTheDocument();
        expect(
            screen.queryByText(/Wyświetlane są ostatnio znane zdarzenia/),
        ).not.toBeInTheDocument();
    });

    it('does not add a no-change LED report after a command timeout', () => {
        const timedOutLed = { ...ledDevice(), activeCommandId: undefined };
        render(<App />);
        act(() =>
            MockWebSocket.latest().emitMessage(
                createRoomSnapshotMessage({
                    devices: [temperatureDevice(), windowTemperatureDevice(), timedOutLed],
                    activeCommands: [],
                    recentEvents: [
                        {
                            recordId: `rec:v1:sha256:${'c'.repeat(64)}`,
                            occurredAt: '2026-06-08T09:30:01.000Z',
                            durability: 'durable',
                            storageSequence: 1,
                            source: 'backend',
                            deviceId: 'led-main',
                            commandId: 'cmd-1',
                            eventType: 'command.timed_out',
                            payload: {
                                timeoutMs: 5000,
                                reason: 'confirmation_not_received',
                            },
                        },
                    ],
                }),
            ),
        );

        const feed = screen.getByRole('region', { name: 'Ostatnie istotne zdarzenia' });
        expect(feed).toHaveTextContent('Nie otrzymano potwierdzenia polecenia w czasie.');
        expect(within(feed).getAllByRole('listitem')).toHaveLength(1);
        expect(
            screen.queryByText(/Wyświetlane są ostatnio znane zdarzenia/),
        ).not.toBeInTheDocument();

        act(() =>
            MockWebSocket.latest().emitMessage({
                messageType: 'device.updated',
                previousRevision: 0,
                revision: 1,
                sentAt: '2026-06-08T09:30:02Z',
                payload: timedOutLed,
            }),
        );

        expect(feed).toHaveTextContent('Nie otrzymano potwierdzenia polecenia w czasie.');
        expect(within(feed).getAllByRole('listitem')).toHaveLength(1);
        expect(
            screen.queryByText(/Wyświetlane są ostatnio znane zdarzenia/),
        ).not.toBeInTheDocument();
    });

    it('opens the desktop feed by default and lets the same button hide and restore it', async () => {
        const user = userEvent.setup();
        render(<App />);

        const toggle = screen.getByRole('button', { name: 'Ukryj ostatnie zdarzenia' });
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Ładowanie ostatnich zdarzeń…')).toBeInTheDocument();
        expect(screen.queryByText('Brak istotnych zdarzeń.')).not.toBeInTheDocument();

        act(() => MockWebSocket.latest().emitMessage(createRoomSnapshotMessage()));
        expect(screen.getByRole('region', { name: 'Ostatnie istotne zdarzenia' })).toBeVisible();

        await user.click(toggle);
        expect(toggle).toHaveAccessibleName('Pokaż ostatnie zdarzenia');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('region', { name: 'Ostatnie istotne zdarzenia' })).toBeNull();
        expect(toggle).toHaveFocus();

        await user.keyboard(' ');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('region', { name: 'Ostatnie istotne zdarzenia' })).toBeVisible();

        await user.keyboard('{Enter}');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('starts narrow views closed and keeps a manual choice through a viewport change', async () => {
        const media = createMockMediaQuery(true);
        vi.stubGlobal('matchMedia', media.matchMedia);
        const user = userEvent.setup();
        render(<App />);
        act(() => MockWebSocket.latest().emitMessage(createRoomSnapshotMessage()));

        const toggle = screen.getByRole('button', { name: 'Pokaż ostatnie zdarzenia' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('region', { name: 'Ostatnie istotne zdarzenia' })).toBeNull();

        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        act(() => media.setNarrow(false));
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        act(() => media.setNarrow(true));
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('rejects a snapshot with a role outside the current platform contract', () => {
        render(<App />);
        act(() =>
            MockWebSocket.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [unsupportedDevice()], activeCommands: [] }),
            ),
        );

        expect(screen.queryByRole('heading', { name: 'Humidity sensor' })).not.toBeInTheDocument();
        expect(
            screen.getByText('Ponowne łączenie ze strumieniem pokoju w czasie rzeczywistym…'),
        ).toBeInTheDocument();
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

function createMockMediaQuery(initialNarrow: boolean) {
    let narrow = initialNarrow;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();

    return {
        matchMedia: (media: string) => ({
            media,
            get matches() {
                return narrow;
            },
            addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
                listeners.add(listener),
            removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
                listeners.delete(listener),
        }),
        setNarrow(value: boolean) {
            narrow = value;
            listeners.forEach((listener) => listener({ matches: value } as MediaQueryListEvent));
        },
    };
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
    devices = [temperatureDevice(), windowTemperatureDevice(), ledDevice()],
    activeCommands = [pendingCommand()],
    recentEvents = [],
}: {
    devices?: unknown[];
    activeCommands?: unknown[];
    recentEvents?: unknown[];
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
            recentEvents,
            platform: { storage: availableStorage() },
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
        delivery: {
            status: 'handed_off',
            dispatchedAt: '2026-06-08T09:30:01Z',
            deadlineAt: '2026-06-08T09:31:00Z',
        },
        durability: 'durable',
        lifecycleDurability: 'durable',
    };
}

function temperatureDevice() {
    return {
        deviceId: 'temp-desk',
        name: 'Desk Temperature',
        role: 'temperature-sensor',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        healthDurability: 'durable',
        reportedState: { temperature: 22.4, temperatureUnit: 'celsius' },
        commandAvailability: { policy: 'block', reason: 'read_only_device' },
        observationStatus: {
            temperature: {
                freshness: 'fresh',
                lastObservedAt: '2026-06-08T09:30:00Z',
                durability: 'durable',
            },
        },
    };
}

function windowTemperatureDevice() {
    return {
        ...temperatureDevice(),
        deviceId: 'temp-window',
        name: 'Window Temperature',
    };
}

function ledDevice() {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        healthDurability: 'durable',
        reportedState: { power: 'off' },
        commandAvailability: { policy: 'allow' },
        activeCommandId: 'cmd-1',
        observationStatus: {
            power: {
                freshness: 'fresh',
                lastObservedAt: '2026-06-08T09:30:00Z',
                durability: 'durable',
            },
        },
    };
}

function unsupportedDevice() {
    return {
        deviceId: 'humidity-desk',
        name: 'Humidity sensor',
        role: 'humidity-sensor',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        healthDurability: 'durable',
        reportedState: { humidity: 48 },
        commandAvailability: { policy: 'block', reason: 'read_only_device' },
        observationStatus: {
            humidity: {
                freshness: 'fresh',
                lastObservedAt: '2026-06-08T09:30:00Z',
                durability: 'durable',
            },
        },
    };
}

function availableStorage() {
    return {
        status: 'available' as const,
        changedAt: '2026-06-08T09:30:00Z',
        historyGenerationId: 'generation-test',
        storedThroughSequence: 0,
    };
}
