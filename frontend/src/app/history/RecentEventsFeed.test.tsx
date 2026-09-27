import {
    isRecentEventsProjection,
    type RecentEventProjection,
} from '@smart-room/contracts/history';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RecentEventsFeed } from './RecentEventsFeed';

const occurredAt = '2026-09-10T10:00:00.000Z';
const base = {
    recordId: `rec:v1:sha256:${'a'.repeat(64)}`,
    occurredAt,
    durability: 'volatile' as const,
    source: 'backend' as const,
};
const command = { deviceId: 'led-main', commandId: 'cmd-42' };

const cases: { event: RecentEventProjection; summary: string }[] = [
    {
        event: {
            ...base,
            deviceId: 'led-main',
            eventType: 'device.state.reported',
            payload: { reportedState: { power: 'on' } },
        },
        summary: 'Urządzenie zgłosiło zasilanie: Włączone.',
    },
    {
        event: {
            ...base,
            deviceId: 'temp-desk',
            eventType: 'device.availability.changed',
            payload: {
                previousAvailability: 'online',
                availability: 'offline',
                reason: 'disconnected',
            },
        },
        summary: 'Dostępność zmieniła się: online → offline.',
    },
    {
        event: {
            ...base,
            deviceId: 'temp-desk',
            eventType: 'device.health.changed',
            payload: { previousHealth: 'healthy', health: 'degraded', reason: 'partial_data' },
        },
        summary: 'Stan działania zmienił się: prawidłowy → pogorszony.',
    },
    {
        event: {
            ...base,
            ...command,
            eventType: 'command.requested',
            payload: {
                commandType: 'set.power',
                requestedState: { power: 'off' },
                requestedBy: 'user',
            },
        },
        summary: 'Zażądano zasilania: Wyłączone.',
    },
    {
        event: {
            ...base,
            ...command,
            eventType: 'command.dispatched',
            payload: { commandType: 'set.power', target: 'simulator-adapter' },
        },
        summary: 'Polecenie wysłano do źródła urządzenia.',
    },
    {
        event: {
            ...base,
            ...command,
            eventType: 'command.delivery_uncertain',
            payload: {
                commandType: 'set.power',
                target: 'simulator-adapter',
                reason: 'transport_ack_lost',
            },
        },
        summary: 'Nie wiadomo, czy polecenie dotarło do urządzenia.',
    },
    {
        event: {
            ...base,
            ...command,
            eventType: 'command.failed',
            payload: { reason: 'command_rejected', message: 'Device rejected command.' },
        },
        summary: 'Polecenie nie powiodło się.',
    },
    {
        event: {
            ...base,
            ...command,
            eventType: 'command.timed_out',
            payload: { timeoutMs: 5000, reason: 'confirmation_not_received' },
        },
        summary: 'Nie otrzymano potwierdzenia polecenia w czasie.',
    },
    {
        event: {
            ...base,
            ...command,
            eventType: 'command.confirmed',
            payload: { sourceEventId: 'evt-42', confirmedAt: occurredAt },
        },
        summary: 'Polecenie potwierdzono raportem urządzenia.',
    },
    {
        event: {
            ...base,
            eventType: 'storage.gap.recorded',
            payload: {
                outageStartedAt: '2026-09-10T09:00:00.000Z',
                outageEndedAt: occurredAt,
                failureReason: 'storage_write_failed',
                boundaryBasis: 'same_process_first_degraded_at',
                observationsBackfilled: false,
            },
        },
        summary: 'Historia ma przerwę po awarii zapisu.',
    },
];

describe('RecentEventsFeed', () => {
    it.each(cases)('explains $event.eventType', ({ event, summary }) => {
        expect(isRecentEventsProjection([event])).toBe(true);

        render(<RecentEventsFeed events={[event]} devices={[]} realtimeUncertain={false} />);

        const feed = screen.getByRole('region', { name: 'Ostatnie istotne zdarzenia' });
        expect(within(feed).getByText(summary)).toBeInTheDocument();
        expect(within(feed).getByRole('time')).toHaveAttribute('dateTime', occurredAt);
        expect(within(feed).getByText('Nieutrwalone')).toBeInTheDocument();
        expect(within(feed).queryByText('[object Object]')).not.toBeInTheDocument();

        if ('deviceId' in event) {
            expect(within(feed).getByText(event.deviceId)).toBeInTheDocument();
        }

        if ('commandId' in event) {
            fireEvent.click(within(feed).getByText('Szczegóły'));
            expect(within(feed).getByText(event.commandId)).toBeVisible();
        }
    });

    it('shows a stable empty state and marks a reconnecting view as last known', () => {
        render(<RecentEventsFeed events={[]} devices={[]} realtimeUncertain />);

        expect(screen.getByText('Brak istotnych zdarzeń.')).toBeInTheDocument();
        expect(screen.getByText(/Wyświetlane są ostatnio znane zdarzenia/)).toBeInTheDocument();
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('shows the outage interval and that observations were not backfilled', () => {
        const gap = cases.at(-1)?.event;

        if (gap?.eventType !== 'storage.gap.recorded') {
            throw new Error('Missing storage gap fixture.');
        }

        render(<RecentEventsFeed events={[gap]} devices={[]} realtimeUncertain={false} />);
        fireEvent.click(screen.getByText('Szczegóły'));

        expect(screen.getByText(/Przerwa od .* do /)).toBeInTheDocument();
        expect(screen.getByText('Nie odtworzono obserwacji z czasu przerwy.')).toBeVisible();
    });

    it('shows requested power only when a failed command carries that context', () => {
        const failed = cases.find((entry) => entry.event.eventType === 'command.failed')?.event;

        if (failed?.eventType !== 'command.failed') {
            throw new Error('Missing failed command fixture.');
        }

        const withRequestedState: RecentEventProjection = {
            ...failed,
            payload: { ...failed.payload, requestedState: { power: 'on' } },
        };
        render(
            <RecentEventsFeed
                events={[withRequestedState]}
                devices={[]}
                realtimeUncertain={false}
            />,
        );
        fireEvent.click(screen.getByText('Szczegóły'));

        expect(screen.getByText('Żądany stan')).toBeVisible();
        expect(screen.getByText('Włączone')).toBeVisible();
    });

    it('does not mark a durable fact as volatile', () => {
        const durable: RecentEventProjection = {
            ...cases[0].event,
            durability: 'durable',
            storageSequence: 1,
        };
        expect(isRecentEventsProjection([durable])).toBe(true);

        render(<RecentEventsFeed events={[durable]} devices={[]} realtimeUncertain={false} />);
        expect(screen.queryByText('Nieutrwalone')).not.toBeInTheDocument();
    });
});
