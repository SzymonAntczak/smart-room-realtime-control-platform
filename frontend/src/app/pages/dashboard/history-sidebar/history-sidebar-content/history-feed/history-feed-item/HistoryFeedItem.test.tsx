import { isUserHistoryItem, type UserHistoryItem } from '@smart-room/contracts/user-history';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatTimestamp } from '../../../../../../features/date-time';

import { HistoryFeedItem } from './HistoryFeedItem';

const fixtures = createUserHistoryFixtures();
describe('user history entry', () => {
    it.each(fixtures.items)('presents $kind without technical diagnostics', (item) => {
        expect(isUserHistoryItem(item)).toBe(true);
        render(
            <ol>
                <HistoryFeedItem item={item} devices={[]} index={14} setSize={-1} />
            </ol>,
        );
        const entry = screen.getByRole('listitem');
        expect(entry).toHaveTextContent(
            item.kind === 'history_gap' ? 'Historia pokoju' : item.deviceName,
        );
        expect(entry.querySelector('time')).toHaveAttribute('dateTime', item.occurredAt);
        expect(entry).toHaveTextContent(formatTimestamp(item.occurredAt));
        const descriptions = {
            power_changed: 'Zaobserwowano zmianę zasilania:',
            availability_changed: 'Dostępność zmieniła się:',
            health_changed: 'Stan działania zmienił się:',
            attempt_failed: 'Próba sterowania nie powiodła się.',
            confirmation_missing: 'Nie otrzymano potwierdzenia zmiany zasilania',
            history_gap: 'Przerwa od',
        };
        expect(entry).toHaveTextContent(descriptions[item.kind]);
        expect(entry).toHaveAttribute('aria-posinset', '15');
        expect(entry).toHaveAttribute('aria-setsize', '-1');
        expect(entry.querySelector('details')).toBeNull();
        expect(entry).not.toHaveTextContent(item.recordId);
        expect(entry).not.toHaveTextContent(item.source);
    });
    it('does not claim a timeout proves that the device did not act', () => {
        render(
            <ol>
                <HistoryFeedItem item={fixtures.timeout} devices={[]} index={0} setSize={1} />
            </ol>,
        );
        expect(screen.getByRole('listitem')).toHaveTextContent(
            'Urządzenie mogło wykonać polecenie.',
        );
    });
    it.each([
        { previous: null, text: 'Poprzednia dostępność nie jest znana.' },
        { previous: 'unknown' as const, text: 'nieznana → offline' },
    ])(
        'distinguishes an unevidenced previous value from a known unknown value ($previous)',
        ({ previous, text }) => {
            const item = { ...fixtures.availabilityChange, previous };
            expect(isUserHistoryItem(item)).toBe(true);
            render(
                <ol>
                    <HistoryFeedItem item={item} devices={[]} index={0} setSize={1} />
                </ol>,
            );
            expect(screen.getByRole('listitem')).toHaveTextContent(text);
        },
    );
    it('labels volatile observations without implying durable storage', () => {
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
        render(
            <ol>
                <HistoryFeedItem item={item} devices={[]} index={0} setSize={1} />
            </ol>,
        );
        expect(screen.getByRole('listitem')).toHaveTextContent('Nieutrwalone');
    });
});
