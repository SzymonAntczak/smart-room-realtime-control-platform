import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import {
    normalizeUserHistoryCursorQueryScope,
    type UserHistoryCursorQueryScope,
} from '@smart-room/contracts/user-history';

export interface UserHistoryCursorPayload {
    version: 1;
    scope: UserHistoryCursorQueryScope;
    rawCursor: string;
}

export interface UserHistoryCursorCodec {
    encode(payload: UserHistoryCursorPayload): string;
    decode(cursor: string): UserHistoryCursorPayload | undefined;
}

/** The raw cursor owns expiry and retention; this signature owns presentation scope. */
export function createUserHistoryCursorCodec({
    secret = randomBytes(32),
}: { secret?: Uint8Array } = {}): UserHistoryCursorCodec {
    const signingKey = Buffer.from(secret);
    const sign = (value: string) => createHmac('sha256', signingKey).update(value).digest();

    return {
        encode(payload) {
            if (!isUserHistoryCursorPayload(payload)) {
                throw new Error('Cannot encode an invalid user-history cursor.');
            }

            const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');

            return `${encoded}.${sign(encoded).toString('base64url')}`;
        },
        decode(cursor) {
            const [encoded, signature, extra] = cursor.split('.');

            if (
                extra !== undefined ||
                encoded === undefined ||
                signature === undefined ||
                !isCanonicalBase64Url(encoded) ||
                !isCanonicalBase64Url(signature)
            ) {
                return undefined;
            }

            const actual = Buffer.from(signature, 'base64url');
            const expected = sign(encoded);

            if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
                return undefined;
            }

            try {
                const value: unknown = JSON.parse(
                    Buffer.from(encoded, 'base64url').toString('utf8'),
                );

                return isUserHistoryCursorPayload(value) ? value : undefined;
            } catch {
                return undefined;
            }
        },
    };
}

function isCanonicalBase64Url(value: string): boolean {
    return (
        /^[A-Za-z0-9_-]+$/.test(value) &&
        Buffer.from(value, 'base64url').toString('base64url') === value
    );
}

function isUserHistoryCursorPayload(value: unknown): value is UserHistoryCursorPayload {
    return (
        typeof value === 'object' &&
        value !== null &&
        Object.keys(value).length === 3 &&
        'version' in value &&
        value.version === 1 &&
        'scope' in value &&
        normalizeUserHistoryCursorQueryScope(value.scope) !== undefined &&
        'rawCursor' in value &&
        typeof value.rawCursor === 'string' &&
        value.rawCursor.length > 0
    );
}
