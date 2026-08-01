import { describe, expect, it } from 'vitest';

import { readDeduplicationRuntimeConfig } from './deduplication-runtime-config';

describe('readDeduplicationRuntimeConfig', () => {
    it('uses documented defaults when no environment values are supplied', () => {
        expect(readDeduplicationRuntimeConfig({})).toEqual({
            deduplicationRetentionMs: 600_000,
            deduplicationEntryLimit: 1000,
        });
    });

    it('reads positive integer overrides', () => {
        expect(
            readDeduplicationRuntimeConfig({
                DEDUPLICATION_RETENTION_MS: '300000',
                DEDUPLICATION_ENTRY_LIMIT: '2500',
            }),
        ).toEqual({
            deduplicationRetentionMs: 300_000,
            deduplicationEntryLimit: 2500,
        });
    });

    it.each(['0', '-1', '1.5', 'NaN'])('rejects an invalid retention value: %s', (value) => {
        expect(() => readDeduplicationRuntimeConfig({ DEDUPLICATION_RETENTION_MS: value })).toThrow(
            'DEDUPLICATION_RETENTION_MS must be a positive safe integer.',
        );
    });
});
