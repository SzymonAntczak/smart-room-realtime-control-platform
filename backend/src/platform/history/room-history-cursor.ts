import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import {
    type HistoryCursorQueryScope,
    normalizeHistoryCursorQueryScope,
} from '@smart-room/contracts/history';
import { normalizeIsoTimestamp } from '@smart-room/contracts/validation';

import type { HistoryPagePosition, PinnedHistoryBounds } from '../storage/room-storage';

const cursorVersion = 1;

export interface HistoryCursorPayload {
    version: typeof cursorVersion;
    scope: HistoryCursorQueryScope;
    bounds: PinnedHistoryBounds;
    position: HistoryPagePosition;
}

export interface HistoryCursorCodec {
    encode(payload: HistoryCursorPayload): string;
    decode(cursor: string): HistoryCursorPayload | undefined;
}

export interface HistoryCursorCodecConfig {
    secret?: Uint8Array;
}

/**
 * Creates a process-local, tamper-evident cursor codec. The default secret is
 * intentionally ephemeral, so cursors may be invalidated by a backend restart.
 */
export function createHistoryCursorCodec({
    secret = randomBytes(32),
}: HistoryCursorCodecConfig = {}): HistoryCursorCodec {
    const signingKey = Buffer.from(secret);

    return {
        encode(payload) {
            if (!isHistoryCursorPayload(payload)) {
                throw new Error('Cannot encode an invalid history cursor payload.');
            }

            const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
            const signature = sign(encodedPayload, signingKey);

            return `${encodedPayload}.${signature.toString('base64url')}`;
        },
        decode(cursor) {
            const parts = cursor.split('.');
            const encodedPayload = parts[0];
            const encodedSignature = parts[1];

            if (
                parts.length !== 2 ||
                encodedPayload === undefined ||
                encodedPayload.length === 0 ||
                encodedSignature === undefined ||
                encodedSignature.length === 0 ||
                !isCanonicalBase64Url(encodedPayload) ||
                !isCanonicalBase64Url(encodedSignature)
            ) {
                return undefined;
            }

            let signature: Buffer;

            try {
                signature = Buffer.from(encodedSignature, 'base64url');
            } catch {
                return undefined;
            }

            const expectedSignature = sign(encodedPayload, signingKey);

            if (
                signature.length !== expectedSignature.length ||
                !timingSafeEqual(signature, expectedSignature)
            ) {
                return undefined;
            }

            try {
                const value: unknown = JSON.parse(
                    Buffer.from(encodedPayload, 'base64url').toString('utf8'),
                );

                return isHistoryCursorPayload(value) ? value : undefined;
            } catch {
                return undefined;
            }
        },
    };
}

function sign(payload: string, secret: Uint8Array): Buffer {
    return createHmac('sha256', secret).update(payload).digest();
}

function isCanonicalBase64Url(value: string): boolean {
    return (
        /^[A-Za-z0-9_-]+$/.test(value) &&
        Buffer.from(value, 'base64url').toString('base64url') === value
    );
}

function isHistoryCursorPayload(value: unknown): value is HistoryCursorPayload {
    if (!isObjectWithExactKeys(value, ['version', 'scope', 'bounds', 'position'])) {
        return false;
    }

    return (
        value.version === cursorVersion &&
        normalizeHistoryCursorQueryScope(value.scope) !== undefined &&
        isPinnedHistoryBounds(value.bounds) &&
        isHistoryPagePosition(value.position, value.bounds.throughSequence)
    );
}

function isPinnedHistoryBounds(value: unknown): value is PinnedHistoryBounds {
    return (
        isObjectWithExactKeys(value, [
            'historyGenerationId',
            'throughSequence',
            'retentionAsOf',
            'retentionRevision',
            'expiresAt',
        ]) &&
        typeof value.historyGenerationId === 'string' &&
        value.historyGenerationId.length > 0 &&
        isNonNegativeInteger(value.throughSequence) &&
        isCanonicalTimestamp(value.retentionAsOf) &&
        isNonNegativeInteger(value.retentionRevision) &&
        isCanonicalTimestamp(value.expiresAt)
    );
}

function isHistoryPagePosition(
    value: unknown,
    throughSequence: number,
): value is HistoryPagePosition {
    return (
        isObjectWithExactKeys(value, ['occurredAt', 'storageSequence']) &&
        isCanonicalTimestamp(value.occurredAt) &&
        isPositiveInteger(value.storageSequence) &&
        value.storageSequence <= throughSequence
    );
}

function isObjectWithExactKeys(
    value: unknown,
    keys: readonly string[],
): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const actualKeys = Object.keys(value);

    return actualKeys.length === keys.length && keys.every((key) => key in value);
}

function isCanonicalTimestamp(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.endsWith('Z') &&
        normalizeIsoTimestamp(value) !== undefined
    );
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
