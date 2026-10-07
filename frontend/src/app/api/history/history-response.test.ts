import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { describe, expect, it } from 'vitest';

import { validateHistoryResponse } from './history-response';

const { page, powerChange } = createUserHistoryFixtures();

describe('user history HTTP response validation', () => {
    it('returns a validated page without changing source identity or sparse-page semantics', () => {
        const body: unknown = structuredClone(page);
        const result = validateHistoryResponse(200, body);
        expect(result.kind).toBe('page');

        if (result.kind !== 'page') {
            throw new Error('Expected a validated history page.');
        }

        expect(result.page.items[0]?.recordId).toBe(powerChange.recordId);
        expect(result.page).toBe(body);
        const sparse = { ...page, items: [], nextCursor: 'opaque-user-cursor' };
        expect(validateHistoryResponse(200, sparse)).toEqual({ kind: 'page', page: sparse });
    });

    it('distinguishes typed cursor errors and unavailable storage from an empty result', () => {
        for (const error of [
            'cursor_expired',
            'history_generation_changed',
            'cursor_query_mismatch',
            'invalid_cursor',
        ]) {
            const body = { error, message: 'History cursor could not be read.' };
            expect(validateHistoryResponse(400, body)).toEqual({
                kind: 'cursor_error',
                error: body,
            });
        }

        const unavailable = {
            error: 'durable_history_unavailable',
            message: 'History is unavailable.',
        };
        expect(validateHistoryResponse(503, unavailable)).toEqual({
            kind: 'unavailable',
            error: unavailable,
        });
        expect(validateHistoryResponse(200, unavailable)).toEqual({ kind: 'invalid_response' });
        expect(validateHistoryResponse(503, page)).toEqual({ kind: 'invalid_response' });
        expect(validateHistoryResponse(500, page)).toEqual({ kind: 'invalid_response' });
    });

    it('rejects an entire response with malformed entries without stripping or fixing them', () => {
        for (const malformed of [
            { ...page, items: [{ ...powerChange, commandId: 'secret-command' }] },
            { ...page, items: [{ ...powerChange, occurredAt: 'not-a-date' }] },
            { ...page, items: [{ ...powerChange, previous: powerChange.current }] },
            { ...page, items: [powerChange, powerChange] },
            { ...page, throughSequence: 0 },
            { ...page, payload: {} },
            { error: 'durable_history_unavailable' },
            null,
            'invalid JSON body',
        ]) {
            const before = structuredClone(malformed);
            expect(validateHistoryResponse(200, malformed)).toEqual({
                kind: 'invalid_response',
            });
            expect(malformed).toEqual(before);
        }
    });

    it('validates error bodies strictly before exposing them to a future session', () => {
        expect(validateHistoryResponse(400, { error: 'cursor_expired' })).toEqual({
            kind: 'invalid_response',
        });
        expect(
            validateHistoryResponse(400, { error: 'unsupported', message: 'Bad cursor.' }),
        ).toEqual({ kind: 'invalid_response' });
        expect(
            validateHistoryResponse(503, {
                error: 'durable_history_unavailable',
                message: 'Unavailable.',
                payload: {},
            }),
        ).toEqual({ kind: 'invalid_response' });
    });
});
