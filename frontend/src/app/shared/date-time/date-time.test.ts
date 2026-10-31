import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatTimestamp } from './date-time';

describe('formatTimestamp', () => {
    const WarsawEnglish = { locale: 'en-GB', timeZone: 'Europe/Warsaw' } as const;

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function detectZone(timeZone: string) {
        const options = new Intl.DateTimeFormat().resolvedOptions();
        vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
            ...options,
            timeZone,
        });
    }

    it('uses browser formatting preferences independently of Polish application translations', () => {
        vi.stubGlobal('navigator', { languages: ['en-GB', 'pl-PL'] });
        detectZone('Europe/Warsaw');

        const formatted = formatTimestamp('2026-01-15T12:34:56Z');

        expect(formatted).toContain('Jan');
        expect(formatted).not.toContain('sty');
        expect(formatted).toContain('13:34:56');
        expect(formatted).toMatch(/GMT\+1|CET/);
    });

    it('skips empty and invalid browser preferences before the first valid locale', () => {
        vi.stubGlobal('navigator', { languages: ['', 'not_a_locale', 'en-GB', 'pl'] });
        detectZone('UTC');

        expect(formatTimestamp('2026-01-15T12:34:56Z')).toContain('Jan');
    });

    it.each([undefined, {}, { languages: [] }, { languages: ['', 'not_a_locale'] }])(
        'falls back to Polish when browser locale preferences are missing or invalid (%j)',
        (browser) => {
            vi.stubGlobal('navigator', browser);
            detectZone('UTC');

            const formatted = formatTimestamp('2026-01-15T12:34:56Z');

            expect(formatted).toContain('sty');
            expect(formatted).toContain('12:34:56');
            expect(formatted).toContain('UTC');
        },
    );

    it.each(['', ' ', 'Invalid/TimeZone'])(
        'falls back to UTC when the detected time zone is unusable (%j)',
        (timeZone) => {
            vi.stubGlobal('navigator', { languages: ['en-GB'] });
            detectZone(timeZone);

            const formatted = formatTimestamp('2026-07-15T12:34:56Z');

            expect(formatted).toContain('12:34:56');
            expect(formatted).toContain('UTC');
        },
    );

    it('still formats in UTC when browser time-zone detection throws', () => {
        vi.stubGlobal('navigator', { languages: ['en-GB'] });
        vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
            throw new Error('Time-zone detection unavailable');
        });

        const formatted = formatTimestamp('2026-07-15T12:34:56Z');

        expect(formatted).toContain('12:34:56');
        expect(formatted).toContain('UTC');
    });

    it.each([
        ['winter', '2026-01-15T12:34:56Z', '13:34:56', /GMT\+1|CET/],
        ['summer', '2026-07-15T12:34:56Z', '14:34:56', /GMT\+2|CEST/],
    ])(
        'converts a %s UTC timestamp to Warsaw time and includes its zone',
        (_, timestamp, time, zone) => {
            const formatted = formatTimestamp(timestamp, WarsawEnglish);

            expect(formatted).toContain(time);
            expect(formatted).toMatch(zone);
        },
    );

    it('uses the supplied locale for the visible date format', () => {
        const timestamp = '2026-01-15T12:34:56Z';
        const polish = formatTimestamp(timestamp, { locale: 'pl-PL', timeZone: 'Europe/Warsaw' });
        const english = formatTimestamp(timestamp, WarsawEnglish);

        expect(polish).not.toBe(english);
        expect(polish).toContain('13:34:56');
        expect(english).toContain('13:34:56');
    });
});
