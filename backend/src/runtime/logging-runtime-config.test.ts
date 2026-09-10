import { describe, expect, it } from 'vitest';

import { backendLogLevels, readLoggingRuntimeConfig } from './logging-runtime-config';

describe('readLoggingRuntimeConfig', () => {
    it('uses info when LOG_LEVEL is absent or blank', () => {
        expect(readLoggingRuntimeConfig({})).toEqual({ logLevel: 'info' });
        expect(readLoggingRuntimeConfig({ LOG_LEVEL: '   ' })).toEqual({ logLevel: 'info' });
    });

    it.each(backendLogLevels)('accepts the supported %s log level', (logLevel) => {
        expect(readLoggingRuntimeConfig({ LOG_LEVEL: logLevel })).toEqual({ logLevel });
    });

    it.each(['INFO', 'verbose'])('rejects unsupported log levels: %s', (logLevel) => {
        expect(() => readLoggingRuntimeConfig({ LOG_LEVEL: logLevel })).toThrow(
            'LOG_LEVEL must be one of: trace, debug, info, warn, error, fatal, silent.',
        );
    });
});
