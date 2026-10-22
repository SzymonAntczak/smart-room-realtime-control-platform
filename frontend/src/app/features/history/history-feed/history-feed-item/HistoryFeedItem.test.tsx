import { isUserHistoryItem, type UserHistoryItem } from '@smart-room/contracts/user-history';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { i18n } from '../../../../i18n';
import { formatTimestamp } from '../../../date-time';

import { HistoryFeedItem } from './HistoryFeedItem';

const fixtures = createUserHistoryFixtures();
describe('user history entry', () => {
    it('labels only volatile entries in mixed history and removes the label for a durable replacement', () => {
        const durableOther = { ...fixtures.timeout, recordId: `rec:v1:sha256:${'d'.repeat(64)}` };
        const item: UserHistoryItem = {
            kind: 'attempt_failed',
            recordId: fixtures.failure.recordId,
            occurredAt: fixtures.failure.occurredAt,
            source: fixtures.failure.source,
            deviceId: 'led-main',
            deviceName: 'Main LED',
            durability: 'volatile',
        };
        expect(isUserHistoryItem(item)).toBe(true);
        expect(isUserHistoryItem(durableOther)).toBe(true);
        const { rerender } = render(
            <ol>
                <HistoryFeedItem item={item} index={0} setSize={2} />
                <HistoryFeedItem item={durableOther} index={1} setSize={2} />
            </ol>,
        );
        const entries = screen.getAllByRole('listitem');
        expect(entries).toHaveLength(2);
        expect(
            within(screen.getByTestId(`history-item-${item.recordId}`)).getByText(
                i18n.t('feed.volatile', { ns: 'dashboard' }),
            ),
        ).toBeInTheDocument();
        expect(
            within(screen.getByTestId(`history-item-${durableOther.recordId}`)).queryByText(
                i18n.t('feed.volatile', { ns: 'dashboard' }),
            ),
        ).toBeNull();
        rerender(
            <ol>
                <HistoryFeedItem item={fixtures.failure} index={0} setSize={1} />
            </ol>,
        );
        expect(screen.queryByText(i18n.t('feed.volatile', { ns: 'dashboard' }))).toBeNull();
    });

    it.each(fixtures.items)('presents $kind without technical diagnostics', (item) => {
        expect(isUserHistoryItem(item)).toBe(true);
        render(
            <ol>
                <HistoryFeedItem item={item} index={14} setSize={-1} />
            </ol>,
        );
        const entry = screen.getByRole('listitem');
        expect(entry).toHaveTextContent(
            item.kind === 'history_gap'
                ? i18n.t('history.room', { ns: 'dashboard' })
                : item.deviceName,
        );
        expect(entry.querySelector('time')).toHaveAttribute('dateTime', item.occurredAt);
        expect(entry).toHaveTextContent(formatTimestamp(item.occurredAt));
        const descriptions = {
            power_changed: i18n.t('history.powerChanged', {
                ns: 'dashboard',
                previous: i18n.t('led.off', { ns: 'dashboard' }),
                current: i18n.t('led.on', { ns: 'dashboard' }),
            }),
            availability_changed: i18n.t('feed.availabilityChanged', {
                ns: 'dashboard',
                previous: i18n.t('feed.availability.online', { ns: 'dashboard' }),
                current: i18n.t('feed.availability.offline', { ns: 'dashboard' }),
            }),
            health_changed: i18n.t('feed.healthChanged', {
                ns: 'dashboard',
                previous: i18n.t('feed.health.healthy', { ns: 'dashboard' }),
                current: i18n.t('feed.health.degraded', { ns: 'dashboard' }),
            }),
            attempt_failed: i18n.t('history.failed', { ns: 'dashboard' }),
            confirmation_missing: i18n.t('history.confirmationMissing', {
                ns: 'dashboard',
                power: i18n.t('led.on', { ns: 'dashboard' }),
            }),
            history_gap: i18n.t('feed.gapInterval', {
                ns: 'dashboard',
                from: formatTimestamp(fixtures.gap.outageStartedAt),
                to: formatTimestamp(fixtures.gap.outageEndedAt),
            }),
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
                <HistoryFeedItem item={fixtures.timeout} index={0} setSize={1} />
            </ol>,
        );
        expect(screen.getByRole('listitem')).toHaveTextContent(
            i18n.t('history.confirmationMissing', {
                ns: 'dashboard',
                power: i18n.t('led.on', { ns: 'dashboard' }),
            }),
        );
    });
    it.each([
        {
            previous: null,
            text: i18n.t('history.availabilityObserved', {
                ns: 'dashboard',
                current: i18n.t('feed.availability.offline', { ns: 'dashboard' }),
            }),
        },
        {
            previous: 'unknown' as const,
            text: i18n.t('feed.availabilityChanged', {
                ns: 'dashboard',
                previous: i18n.t('feed.availability.unknown', { ns: 'dashboard' }),
                current: i18n.t('feed.availability.offline', { ns: 'dashboard' }),
            }),
        },
    ])(
        'distinguishes an unevidenced previous value from a known unknown value ($previous)',
        ({ previous, text }) => {
            const item = { ...fixtures.availabilityChange, previous };
            expect(isUserHistoryItem(item)).toBe(true);
            render(
                <ol>
                    <HistoryFeedItem item={item} index={0} setSize={1} />
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
                <HistoryFeedItem item={item} index={0} setSize={1} />
            </ol>,
        );
        expect(screen.getByRole('listitem')).toHaveTextContent(
            i18n.t('feed.volatile', { ns: 'dashboard' }),
        );
    });
});
