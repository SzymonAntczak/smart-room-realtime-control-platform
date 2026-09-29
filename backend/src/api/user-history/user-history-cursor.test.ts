import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createUserHistoryCursorCodec, type UserHistoryCursorPayload } from './user-history-cursor';

const secret = Buffer.alloc(32, 9);
const payload: UserHistoryCursorPayload = {
    version: 1,
    scope: { dataset: 'user_history', order: 'occurred_at_desc', pageSize: 50 },
    rawCursor: 'unchanged-raw-cursor',
};

describe('BFF user-history cursor encoding and validation', () => {
    it('preserves raw cursor and rejects tampering or another instance key', () => {
        const codec = createUserHistoryCursorCodec({ secret });
        const cursor = codec.encode(payload);
        expect(codec.decode(cursor)).toEqual(payload);
        expect(createUserHistoryCursorCodec().decode(cursor)).toBeUndefined();
        const changed = { ...payload, scope: { ...payload.scope, pageSize: 20 } };
        const signature = cursor.split('.')[1];
        const forged = `${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`;
        expect(codec.decode(forged)).toBeUndefined();

        for (const malformed of ['', 'forged', `${cursor}.`, `${cursor}=`, `${cursor}x`]) {
            expect(codec.decode(malformed)).toBeUndefined();
        }
    });

    it.each([
        { ...payload, version: 2 },
        { ...payload, rawCursor: '' },
        { ...payload, extra: true },
        { ...payload, scope: { ...payload.scope, dataset: 'significant_facts' } },
        { ...payload, scope: { ...payload.scope, pageSize: 101 } },
        { ...payload, scope: { ...payload.scope, deviceId: 'led-main' } },
    ])('rejects unsupported payload even when signed with the correct key', (invalid) => {
        const encoded = Buffer.from(JSON.stringify(invalid)).toString('base64url');
        const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
        expect(
            createUserHistoryCursorCodec({ secret }).decode(`${encoded}.${signature}`),
        ).toBeUndefined();
    });
});
