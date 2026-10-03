import { isUserHistoryItem, type UserHistoryItem } from '@smart-room/contracts/user-history';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RecentEventsFeed } from './RecentEventsFeed';
const fixtures = createUserHistoryFixtures();
describe('user history feed', () => {
    it.each(fixtures.items)('presents $kind without technical diagnostics', (item) => {
        expect(isUserHistoryItem(item)).toBe(true);
        render(<RecentEventsFeed events={[item]} devices={[]} realtimeUncertain={false} />);
        const entry = screen.getByRole('listitem');
        expect(entry).toHaveTextContent(
            item.kind === 'history_gap' ? 'Historia pokoju' : item.deviceName,
        );
        expect(entry.querySelector('time')).toHaveAttribute('dateTime', item.occurredAt);
        expect(entry.querySelector('details')).toBeNull();
        expect(entry).not.toHaveTextContent(item.recordId);
        expect(entry).not.toHaveTextContent(item.source);
    });
    it('does not claim a timeout proves that the device did not act', () => {
        render(
            <RecentEventsFeed events={[fixtures.timeout]} devices={[]} realtimeUncertain={false} />,
        );
        expect(screen.getByRole('listitem')).toHaveTextContent(
            'Urządzenie mogło wykonać polecenie.',
        );
    });
    it('distinguishes an unevidenced previous value from a known unknown value', () => {
        render(
            <RecentEventsFeed
                events={[{ ...fixtures.availabilityChange, previous: null }]}
                devices={[]}
                realtimeUncertain={false}
            />,
        );
        expect(screen.getByRole('listitem')).toHaveTextContent(
            'Poprzednia dostępność nie jest znana.',
        );
    });
    it('labels volatile and last-known history honestly', () => {
        const item: UserHistoryItem = {
            kind: 'power_changed',
            previous: 'off',
            current: 'on',
            recordId: fixtures.powerChange.recordId,
            occurredAt: fixtures.powerChange.occurredAt,
            deviceId: 'led-main',
            deviceName: 'Main LED',
            source: 'backend',
            durability: 'volatile',
        };
        expect(isUserHistoryItem(item)).toBe(true);
        render(<RecentEventsFeed events={[item]} devices={[]} realtimeUncertain />);
        expect(screen.getByRole('listitem')).toHaveTextContent('Nieutrwalone');
        expect(screen.getByText(/Wyświetlane są ostatnio znane zdarzenia/)).toBeInTheDocument();
    });
    it('renders an empty history without manufacturing command progress', () => {
        render(<RecentEventsFeed events={[]} devices={[]} realtimeUncertain={false} />);
        expect(screen.getByText('Brak istotnych zdarzeń.')).toBeInTheDocument();
        expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    });
});
