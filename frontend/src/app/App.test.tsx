import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import type { RoomBffRealtimeServerMessage } from '@smart-room/contracts/room-bff';
import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import { isUserHistoryPage } from '@smart-room/contracts/user-history';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import type { Components, ContextProp, ItemProps, ListProps } from 'react-virtuoso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockEventSource } from '../test/room/mock-event-source';

import { App } from './App';
interface HistoryFeedContext {
    devices: [];
    endReached: boolean;
    totalItems: number;
}

vi.mock('react-virtuoso', async () => {
    const { createElement } = await import('react');

    return {
        Virtuoso: ({
            data = [],
            components,
            context,
        }: {
            data?: readonly UserHistoryItem[];
            components: Components<UserHistoryItem, HistoryFeedContext, HTMLUListElement>;
            context: HistoryFeedContext;
        }) => {
            const List = components.List as ComponentType<ListProps<HTMLUListElement>>;
            const Item = components.Item as ComponentType<
                ItemProps<UserHistoryItem> & ContextProp<HistoryFeedContext>
            >;

            return createElement(
                List,
                { 'data-testid': 'history-list', style: { height: data.length * 192 } },
                ...data.map((item, index) =>
                    createElement(Item, {
                        key: item.recordId,
                        item,
                        'data-index': index,
                        'data-item-index': index,
                        'data-known-size': 192,
                        style: { transform: `translateY(${index * 192}px)` },
                        context,
                    }),
                ),
            );
        },
    };
});

vi.mock(
    './pages/dashboard/history-sidebar/history-sidebar-content/history-feed/useHistoryVirtualizer',
    async () => {
        const { createRef } = await import('react');

        return {
            useHistoryVirtualizer: () => ({
                virtuosoRef: createRef(),
            }),
        };
    },
);
describe('App', () => {
    beforeEach(() => {
        MockEventSource.instances.length = 0;
        vi.stubGlobal('EventSource', MockEventSource);
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise(() => undefined)),
        );
    });

    afterEach(() => vi.unstubAllGlobals());

    it('waits for a realtime snapshot before rendering device controls', () => {
        render(<App />);

        expect(
            screen.getByText('Łączenie ze strumieniem pokoju w czasie rzeczywistym…'),
        ).toBeInTheDocument();
    });

    it('requests a fresh baseline without merging replacement history when the sidebar opens during unknown storage', async () => {
        const fixtures = createUserHistoryFixtures();
        const replacementPage = {
            ...fixtures.page,
            pageSize: 50,
            historyGenerationId: 'replacement',
        };
        expect(isUserHistoryPage(replacementPage)).toBe(true);

        const user = userEvent.setup();
        const { unmount } = render(<App />);
        await user.click(screen.getByRole('button', { name: 'Ukryj ostatnie zdarzenia' }));
        act(() =>
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({ userHistory: [fixtures.gap] }),
            ),
        );
        act(() =>
            MockEventSource.latest().emitMessage({
                messageType: 'platform.updated',
                previousRevision: 0,
                revision: 1,
                sentAt: '2026-06-08T09:30:02Z',
                payload: {
                    storage: {
                        status: 'degraded',
                        changedAt: '2026-06-08T09:30:02Z',
                        reason: 'storage_write_failed',
                        historyGenerationId: null,
                        storedThroughSequence: null,
                    },
                },
            } satisfies RoomBffRealtimeServerMessage),
        );
        const originalSource = MockEventSource.latest();
        const close = vi.spyOn(originalSource, 'close');
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(JSON.stringify(replacementPage)));
        vi.stubGlobal('fetch', fetcher);

        await user.click(screen.getByRole('button', { name: 'Pokaż ostatnie zdarzenia' }));
        await waitFor(() => expect(close).toHaveBeenCalledOnce());

        const history = screen.getByRole('region', { name: 'Przewijana historia zdarzeń' });
        expect(fetcher).toHaveBeenCalledOnce();
        expect(within(history).getByText('Ładowanie historii…')).toBeInTheDocument();
        expect(
            within(history).getByTestId(`history-item-${fixtures.gap.recordId}`),
        ).toBeInTheDocument();

        for (const item of replacementPage.items) {
            expect(
                within(history).queryByTestId(`history-item-${item.recordId}`),
            ).not.toBeInTheDocument();
        }

        unmount();
    });

    it('does not render development scenario controls', () => {
        render(<App />);

        expect(screen.queryByText('Scenariusze programistyczne')).not.toBeInTheDocument();
    });

    it('renders supported device cards from one room snapshot and maps LED commands by device', () => {
        render(<App />);
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));

        expect(screen.getByRole('heading', { name: 'Temperatura biurka' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Temperatura okna' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Główne LED' })).toBeInTheDocument();
        expect(screen.getByText(/Zażądano: Włączone/)).toBeInTheDocument();
        expect(screen.queryByText('Scenariusze programistyczne')).not.toBeInTheDocument();
    });

    it('keeps the temperature view visible and marks it uncertain while reconnecting', () => {
        render(<App />);
        act(() =>
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [temperatureDevice()], activeCommands: [] }),
            ),
        );
        act(() => MockEventSource.latest().emitError());

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
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({
                    userHistory: [
                        {
                            recordId: `rec:v1:sha256:${'a'.repeat(64)}`,
                            occurredAt: '2026-06-08T09:30:00.000Z',
                            durability: 'volatile',
                            source: 'backend',
                            deviceId: 'led-main',
                            deviceName: 'Device',
                            kind: 'attempt_failed',
                        },
                    ],
                }),
            ),
        );

        expect(
            screen.getByRole('region', { name: 'Przewijana historia zdarzeń' }),
        ).toHaveTextContent('Próba sterowania nie powiodła się.');
        act(() => MockEventSource.latest().emitError());
        expect(screen.getByText(/Wyświetlane są ostatnio znane zdarzenia/)).toBeInTheDocument();
    });

    it('adds a feed fact from a contiguous device update', () => {
        render(<App />);
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));

        const feed = screen.getByRole('region', { name: 'Przewijana historia zdarzeń' });
        expect(feed).toHaveTextContent('Brak istotnych zdarzeń.');

        act(() =>
            MockEventSource.latest().emitMessage({
                messageType: 'device.updated',
                previousRevision: 0,
                revision: 1,
                sentAt: '2026-06-08T09:30:02Z',
                payload: ledDevice(),
                userHistory: [
                    {
                        recordId: `rec:v1:sha256:${'b'.repeat(64)}`,
                        occurredAt: '2026-06-08T09:30:02.000Z',
                        durability: 'volatile',
                        source: 'backend',
                        deviceId: 'led-main',
                        deviceName: 'Device',
                        kind: 'attempt_failed',
                    },
                ],
            }),
        );

        expect(feed).toHaveTextContent('Próba sterowania nie powiodła się.');
        expect(feed).toHaveTextContent('Główne LED');
    });

    it('keeps live telemetry out of the significant-events feed', () => {
        const { telemetrySample } = createHistoryIdentityFixtures();
        render(<App />);
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));

        const feed = screen.getByRole('region', { name: 'Przewijana historia zdarzeń' });
        expect(feed).toHaveTextContent('Brak istotnych zdarzeń.');

        act(() =>
            MockEventSource.latest().emitMessage({
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
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));

        const feed = screen.getByRole('region', { name: 'Przewijana historia zdarzeń' });
        act(() =>
            MockEventSource.latest().emitMessage({
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
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({
                    devices: [temperatureDevice(), windowTemperatureDevice(), timedOutLed],
                    activeCommands: [],
                    userHistory: [
                        {
                            recordId: `rec:v1:sha256:${'c'.repeat(64)}`,
                            occurredAt: '2026-06-08T09:30:01.000Z',
                            durability: 'durable',
                            storageSequence: 1,
                            source: 'backend',
                            deviceId: 'led-main',
                            deviceName: 'Device',
                            kind: 'confirmation_missing',
                            requestedPower: 'on',
                        },
                    ],
                }),
            ),
        );

        const feed = screen.getByRole('region', { name: 'Przewijana historia zdarzeń' });
        expect(feed).toHaveTextContent('Nie otrzymano potwierdzenia zmiany zasilania');
        expect(within(feed).getAllByRole('listitem')).toHaveLength(1);
        expect(
            screen.queryByText(/Wyświetlane są ostatnio znane zdarzenia/),
        ).not.toBeInTheDocument();

        act(() =>
            MockEventSource.latest().emitMessage({
                messageType: 'device.updated',
                previousRevision: 0,
                revision: 1,
                sentAt: '2026-06-08T09:30:02Z',
                payload: timedOutLed,
            }),
        );

        expect(feed).toHaveTextContent('Nie otrzymano potwierdzenia zmiany zasilania');
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

        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));
        expect(screen.getByRole('region', { name: 'Przewijana historia zdarzeń' })).toBeVisible();

        await user.click(toggle);
        expect(toggle).toHaveAccessibleName('Pokaż ostatnie zdarzenia');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('region', { name: 'Przewijana historia zdarzeń' })).toBeNull();
        expect(toggle).toHaveFocus();

        await user.keyboard(' ');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('region', { name: 'Przewijana historia zdarzeń' })).toBeVisible();

        await user.keyboard('{Enter}');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('starts narrow views closed and keeps a manual choice through a viewport change', async () => {
        const media = createMockMediaQuery(true);
        vi.stubGlobal('matchMedia', media.matchMedia);
        const user = userEvent.setup();
        render(<App />);
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));

        const toggle = screen.getByRole('button', { name: 'Pokaż ostatnie zdarzenia' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('region', { name: 'Przewijana historia zdarzeń' })).toBeNull();

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
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({ devices: [unsupportedDevice()], activeCommands: [] }),
            ),
        );

        expect(screen.queryByRole('heading', { name: 'Humidity sensor' })).not.toBeInTheDocument();
        expect(
            screen.getByText('Ponowne łączenie ze strumieniem pokoju w czasie rzeczywistym…'),
        ).toBeInTheDocument();
    });
});

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

function createRoomSnapshotMessage({
    devices = [temperatureDevice(), windowTemperatureDevice(), ledDevice()],
    activeCommands = [pendingCommand()],
    userHistory = [],
}: {
    devices?: unknown[];
    activeCommands?: unknown[];
    userHistory?: unknown[];
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
            userHistory,
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
