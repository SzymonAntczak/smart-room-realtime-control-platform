import { describe, expect, it } from 'vitest';

import {
    isUserHistoryItem,
    isUserHistoryPage,
    isUserHistoryProjection,
    normalizeUserHistoryCursorQueryScope,
    userHistoryPageQuerySchema,
} from './user-history';
import { createUserHistoryFixtures } from './user-history-fixtures';
import { isSchema } from './validation';

const fixtures = createUserHistoryFixtures();

describe('user history contracts (AC-1–AC-3)', () => {
    it('accepts every user meaning, including unknown prior state and missing failure target', () => {
        for (const item of fixtures.items) {
            expect(isUserHistoryItem(item)).toBe(true);
        }

        expect(isUserHistoryItem({ ...fixtures.powerChange, previous: null })).toBe(true);
        const failure: Record<string, unknown> = { ...fixtures.failure };
        delete failure.requestedPower;
        expect(isUserHistoryItem(failure)).toBe(true);
    });

    it('rejects command progress, telemetry and diagnostic data instead of stripping it', () => {
        for (const kind of [
            'command.requested',
            'command.dispatched',
            'command.confirmed',
            'telemetry',
        ]) {
            expect(isUserHistoryItem({ ...fixtures.powerChange, kind })).toBe(false);
        }

        for (const field of ['payload', 'commandId', 'reason', 'message', 'title', 'description']) {
            expect(isUserHistoryItem({ ...fixtures.powerChange, [field]: 'technical data' })).toBe(
                false,
            );
        }
    });

    it('rejects unchanged known values but permits a genuinely unknown previous value', () => {
        for (const item of [
            fixtures.powerChange,
            fixtures.availabilityChange,
            fixtures.healthChange,
        ]) {
            expect(isUserHistoryItem({ ...item, previous: item.current })).toBe(false);
            expect(isUserHistoryItem({ ...item, previous: null })).toBe(true);
        }
    });

    it('preserves logical identity and enforces durable versus volatile evidence', () => {
        const withoutSequence: Record<string, unknown> = { ...fixtures.powerChange };
        delete withoutSequence.storageSequence;
        expect(isUserHistoryItem(withoutSequence)).toBe(false);
        expect(isUserHistoryItem({ ...withoutSequence, durability: 'volatile' })).toBe(true);
        expect(isUserHistoryItem({ ...fixtures.powerChange, durability: 'volatile' })).toBe(false);
        expect(isUserHistoryItem({ ...fixtures.powerChange, recordId: 'not-a-record' })).toBe(
            false,
        );
        expect(
            isUserHistoryItem({ ...fixtures.powerChange, occurredAt: '2026-09-10T12:00:00+02:00' }),
        ).toBe(false);
        expect(isUserHistoryItem({ ...fixtures.powerChange, occurredAt: 'not-a-date' })).toBe(
            false,
        );
    });

    it('rejects reversed gaps and gaps whose end differs from event time', () => {
        expect(
            isUserHistoryItem({ ...fixtures.gap, outageStartedAt: '2026-09-10T11:00:00Z' }),
        ).toBe(false);
        expect(isUserHistoryItem({ ...fixtures.gap, outageEndedAt: '2026-09-10T09:59:00Z' })).toBe(
            false,
        );
        expect(isUserHistoryItem({ ...fixtures.gap, deviceId: 'led-main' })).toBe(false);
    });

    it('bounds and orders the recent presentation cache by time then logical identity', () => {
        const item = fixtures.powerChange;
        const older = {
            ...item,
            recordId: `rec:v1:sha256:${'0'.repeat(64)}`,
            occurredAt: '2026-09-10T09:00:00Z',
        };
        expect(isUserHistoryProjection([])).toBe(true);
        expect(isUserHistoryProjection([item, older])).toBe(true);
        expect(isUserHistoryProjection([older, item])).toBe(false);
        expect(isUserHistoryProjection([item, item])).toBe(false);
        expect(isUserHistoryProjection([older, { ...item, occurredAt: older.occurredAt }])).toBe(
            false,
        );
        expect(
            isUserHistoryProjection(
                Array.from({ length: 21 }, (_, index) => ({
                    ...item,
                    recordId: `rec:v1:sha256:${index.toString(16).padStart(64, '0')}`,
                })).reverse(),
            ),
        ).toBe(false);
    });

    it('accepts sparse or empty filtered pages with further raw history to read', () => {
        expect(isUserHistoryPage(fixtures.page)).toBe(true);
        expect(
            isUserHistoryPage({ ...fixtures.page, items: [], nextCursor: 'opaque-user-cursor' }),
        ).toBe(true);
        expect(
            isUserHistoryPage({
                ...fixtures.page,
                pageSize: 100,
                nextCursor: 'opaque-user-cursor',
            }),
        ).toBe(true);
        expect(fixtures.page.items[0]?.recordId).toBe(fixtures.powerChange.recordId);
    });

    it('protects the pinned watermark, storage order, durable-only pages and completeness label', () => {
        const first = fixtures.powerChange;
        const second = {
            ...first,
            recordId: `rec:v1:sha256:${'b'.repeat(64)}`,
            storageSequence: 6,
        };
        const page = { ...fixtures.page, pageSize: 2, items: [first, second] };
        expect(isUserHistoryPage(page)).toBe(true);
        expect(isUserHistoryPage({ ...page, items: [second, first] })).toBe(false);
        expect(isUserHistoryPage({ ...page, items: [first, first] })).toBe(false);
        expect(
            isUserHistoryPage({
                ...page,
                items: [first, { ...second, storageSequence: first.storageSequence }],
            }),
        ).toBe(false);
        expect(isUserHistoryPage({ ...page, throughSequence: 6 })).toBe(false);
        expect(isUserHistoryPage({ ...page, pageSize: 1 })).toBe(false);
        expect(isUserHistoryPage({ ...page, completeness: 'complete' })).toBe(false);
        const volatile: Record<string, unknown> = { ...first };
        delete volatile.storageSequence;
        expect(
            isUserHistoryPage({
                ...fixtures.page,
                items: [{ ...volatile, durability: 'volatile' }],
            }),
        ).toBe(false);
        expect(isUserHistoryPage({ ...fixtures.page, items: [], throughSequence: 0 })).toBe(true);
        expect(isUserHistoryPage({ ...fixtures.page, historyGenerationId: null })).toBe(false);
    });

    it('keeps user cursors separate and accepts only bounded, unfiltered query shapes', () => {
        expect(
            normalizeUserHistoryCursorQueryScope({
                dataset: 'user_history',
                order: 'occurred_at_desc',
                pageSize: 20,
            }),
        ).toEqual({ dataset: 'user_history', order: 'occurred_at_desc', pageSize: 20 });
        expect(
            normalizeUserHistoryCursorQueryScope({
                dataset: 'significant_facts',
                order: 'occurred_at_desc',
                pageSize: 20,
            }),
        ).toBeUndefined();

        for (const pageSize of [0, 101, 1.5]) {
            expect(isSchema(userHistoryPageQuerySchema, { pageSize })).toBe(false);
        }

        expect(isSchema(userHistoryPageQuerySchema, { pageSize: 1, cursor: 'opaque' })).toBe(true);
        expect(isSchema(userHistoryPageQuerySchema, { pageSize: 100 })).toBe(true);
        expect(isSchema(userHistoryPageQuerySchema, { pageSize: 20, cursor: '' })).toBe(false);
        expect(isSchema(userHistoryPageQuerySchema, { pageSize: 20, deviceId: 'led-main' })).toBe(
            false,
        );
    });
});
