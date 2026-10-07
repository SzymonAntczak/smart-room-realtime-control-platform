import { describe, expect, it } from 'vitest';

import { FALLBACK_LOCALE, resolveLocale } from './locale';

describe('resolveLocale', () => {
    it('selects Polish for a Polish browser preference', () => {
        expect(resolveLocale(['pl'])).toBe('pl');
    });

    it('selects Polish for a regional Polish browser preference', () => {
        expect(resolveLocale(['pl-PL'])).toBe('pl');
    });

    it('uses Polish as the fallback for missing or unsupported preferences', () => {
        expect(resolveLocale(['en-GB'])).toBe(FALLBACK_LOCALE);
        expect(resolveLocale(undefined)).toBe(FALLBACK_LOCALE);
    });
});
