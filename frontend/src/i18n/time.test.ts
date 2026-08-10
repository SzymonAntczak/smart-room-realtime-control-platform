import { describe, expect, it } from 'vitest';

import { formatTimestamp, resolveTimeFormatContext } from './time';

describe('resolveTimeFormatContext', () => {
    it('uses the browser locale independently of the application translation locale', () => {
        expect(
            resolveTimeFormatContext({
                preferredLocales: ['en-GB', 'pl-PL'],
                detectedTimeZone: 'Europe/Warsaw',
            }),
        ).toEqual({ locale: 'en-GB', timeZone: 'Europe/Warsaw' });
    });

    it('falls back to Polish and UTC for unavailable browser settings', () => {
        expect(
            resolveTimeFormatContext({
                preferredLocales: ['not a locale'],
                detectedTimeZone: 'not/a-time-zone',
            }),
        ).toEqual({ locale: 'pl', timeZone: 'UTC' });
        expect(resolveTimeFormatContext({})).toEqual({ locale: 'pl', timeZone: 'UTC' });
    });
});

describe('formatTimestamp', () => {
    const WarsawEnglish = { locale: 'en-GB', timeZone: 'Europe/Warsaw' } as const;

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
