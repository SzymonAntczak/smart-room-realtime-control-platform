import { describe, expect, it } from 'vitest';

import {
    isMatchingUserHistoryCursorQueryScope,
    isUserHistoryItem,
    isUserHistoryPage,
    isUserHistoryProjection,
    normalizeUserHistoryCursorQueryScope,
    normalizeUserHistoryPageQuery,
    type UserHistoryCursorQueryScope,
    userHistoryFirstPageQuerySchema,
    userHistoryPageQuerySchema,
} from './user-history';
import { createUserHistoryFixtures } from './user-history-fixtures';
import { isSchema } from './validation';

const fixtures = createUserHistoryFixtures();

describe('user history page contracts', () => {
    it('defaults an omitted page size to 50 and rejects invalid query values without mutation', () => {
        const query = { cursor: 'opaque' };
        expect(isSchema(userHistoryFirstPageQuerySchema, {})).toBe(true);
        expect(normalizeUserHistoryPageQuery({})).toEqual({ pageSize: 50 });
        expect(normalizeUserHistoryPageQuery(query)).toEqual({ pageSize: 50, cursor: 'opaque' });
        expect(query).toEqual({ cursor: 'opaque' });

        for (const pageSize of [1, 20, 50, 100]) {
            expect(normalizeUserHistoryPageQuery({ pageSize })).toEqual({ pageSize });
        }

        for (const pageSize of [null, '', '50', 'invalid', 0, 101, 1.5]) {
            expect(normalizeUserHistoryPageQuery({ pageSize })).toBeUndefined();
        }

        expect(normalizeUserHistoryPageQuery({ cursor: '' })).toBeUndefined();
        expect(normalizeUserHistoryPageQuery({ unexpected: true })).toBeUndefined();
        expect(normalizeUserHistoryPageQuery(null)).toBeUndefined();
    });

    it.each([
        {},
        { deviceId: 'led-main' },
        { from: '2026-09-10T10:00:00Z' },
        { to: '2026-09-11T10:00:00Z' },
        { deviceId: 'led-main', from: '2026-09-10T10:00:00Z' },
        { deviceId: 'led-main', to: '2026-09-11T10:00:00Z' },
        { from: '2026-09-10T10:00:00Z', to: '2026-09-11T10:00:00Z' },
        {
            deviceId: 'led-main',
            from: '2026-09-10T10:00:00Z',
            to: '2026-09-11T10:00:00Z',
        },
    ])('accepts optional filters on first and continuation queries: %j', (filters) => {
        expect(isSchema(userHistoryFirstPageQuerySchema, filters)).toBe(true);
        expect(isSchema(userHistoryFirstPageQuerySchema, { ...filters, cursor: 'opaque' })).toBe(
            false,
        );
        expect(normalizeUserHistoryPageQuery(filters)).toEqual({ ...filters, pageSize: 50 });
        expect(
            normalizeUserHistoryPageQuery({ ...filters, pageSize: 20, cursor: 'opaque' }),
        ).toEqual({ ...filters, pageSize: 20, cursor: 'opaque' });
    });

    it('canonicalizes each provided date bound without mutating the query or filling absent filters', () => {
        const query = {
            deviceId: 'led-main',
            from: '2026-09-10T12:00:00+02:00',
            to: '2026-09-10T12:30:00.125+01:00',
            cursor: 'opaque',
        };
        const original = { ...query };
        expect(normalizeUserHistoryPageQuery(query)).toEqual({
            pageSize: 50,
            deviceId: 'led-main',
            from: '2026-09-10T10:00:00Z',
            to: '2026-09-10T11:30:00.125Z',
            cursor: 'opaque',
        });
        expect(query).toEqual(original);
        expect(normalizeUserHistoryPageQuery({ from: query.from })).toEqual({
            pageSize: 50,
            from: '2026-09-10T10:00:00Z',
        });
        expect(normalizeUserHistoryPageQuery({ to: query.to })).toEqual({
            pageSize: 50,
            to: '2026-09-10T11:30:00.125Z',
        });
    });

    it.each([
        { deviceId: '' },
        { deviceId: null },
        { deviceId: ['led-main'] },
        { from: '' },
        { from: 'not-a-date' },
        { from: '2026-09-10' },
        { from: '2026-09-10T10:00:00' },
        { from: '2026-02-30T10:00:00Z' },
        { from: 0 },
        { to: null },
        { to: '' },
        { to: '2026-09-10' },
        { to: '2026-09-10T10:00:00' },
        { to: ['2026-09-10T10:00:00Z'] },
        { unexpected: true },
    ])('rejects malformed filters in queries and cursor scopes without mutation: %j', (filters) => {
        const original = JSON.stringify(filters);
        expect(isSchema(userHistoryFirstPageQuerySchema, filters)).toBe(false);
        expect(normalizeUserHistoryPageQuery(filters)).toBeUndefined();
        expect(
            normalizeUserHistoryCursorQueryScope({
                dataset: 'user_history',
                order: 'occurred_at_desc',
                pageSize: 50,
                ...filters,
            }),
        ).toBeUndefined();
        expect(JSON.stringify(filters)).toBe(original);
    });

    it.each([
        { from: '2026-09-11T10:00:00Z', to: '2026-09-10T10:00:00Z' },
        { from: '2026-09-10T10:00:00Z', to: '2026-09-10T10:00:00Z' },
        { from: '2026-09-10T12:00:00+02:00', to: '2026-09-10T10:00:00.000Z' },
        { from: '2026-09-10T12:00:00+01:00', to: '2026-09-10T12:30:00+02:00' },
    ])('rejects empty or reversed intervals by instant without mutating input: %j', (range) => {
        const original = { ...range };
        expect(normalizeUserHistoryPageQuery(range)).toBeUndefined();
        expect(
            normalizeUserHistoryCursorQueryScope({
                dataset: 'user_history',
                order: 'occurred_at_desc',
                pageSize: 50,
                ...range,
            }),
        ).toBeUndefined();
        expect(range).toEqual(original);
    });
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

    it('keeps user cursors separate and accepts only bounded query shapes', () => {
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
            true,
        );
    });

    it('normalizes complete cursor scopes and matches equivalent instants without mutation', () => {
        const scope: UserHistoryCursorQueryScope = {
            dataset: 'user_history',
            order: 'occurred_at_desc',
            pageSize: 50,
            deviceId: 'led-main',
            from: '2026-09-10T12:00:00+02:00',
            to: '2026-09-11T12:00:00+02:00',
        };
        const normalized = {
            ...scope,
            from: '2026-09-10T10:00:00Z',
            to: '2026-09-11T10:00:00Z',
        };
        const original = { ...scope };
        expect(normalizeUserHistoryCursorQueryScope(scope)).toEqual(normalized);
        expect(isMatchingUserHistoryCursorQueryScope(scope, normalized)).toBe(true);
        expect(isMatchingUserHistoryCursorQueryScope(normalized, scope)).toBe(true);
        expect(
            isMatchingUserHistoryCursorQueryScope(scope, {
                ...normalized,
                from: '2026-09-10T10:00:00.000Z',
            }),
        ).toBe(true);
        expect(scope).toEqual(original);
    });

    it('rejects any reinterpretation, addition or omission of a captured cursor filter', () => {
        const scope = {
            dataset: 'user_history',
            order: 'occurred_at_desc',
            pageSize: 50,
            deviceId: 'led-main',
            from: '2026-09-10T10:00:00Z',
            to: '2026-09-11T10:00:00Z',
        };

        for (const changed of [
            { ...scope, dataset: 'significant_facts' },
            { ...scope, order: 'occurred_at_asc' },
            { ...scope, pageSize: 20 },
            { ...scope, deviceId: 'led-other' },
            { ...scope, from: '2026-09-10T10:00:00.001Z' },
            { ...scope, to: '2026-09-11T10:00:00.001Z' },
        ]) {
            expect(isMatchingUserHistoryCursorQueryScope(scope, changed)).toBe(false);
        }

        for (const field of ['deviceId', 'from', 'to'] as const) {
            const omitted = { ...scope };
            Reflect.deleteProperty(omitted, field);
            expect(isMatchingUserHistoryCursorQueryScope(scope, omitted)).toBe(false);
            expect(isMatchingUserHistoryCursorQueryScope(omitted, scope)).toBe(false);
            expect(isMatchingUserHistoryCursorQueryScope(omitted, omitted)).toBe(true);
        }

        const unfiltered = { dataset: 'user_history', order: 'occurred_at_desc', pageSize: 50 };
        expect(isMatchingUserHistoryCursorQueryScope(unfiltered, unfiltered)).toBe(true);

        for (const invalid of [
            null,
            {},
            { ...unfiltered, pageSize: '50' },
            { ...unfiltered, extra: true },
        ]) {
            expect(isMatchingUserHistoryCursorQueryScope(scope, invalid)).toBe(false);
            expect(isMatchingUserHistoryCursorQueryScope(invalid, scope)).toBe(false);
        }
    });
});
