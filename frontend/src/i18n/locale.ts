export const SUPPORTED_LOCALES = ['pl'] as const;
export const FALLBACK_LOCALE = 'pl';

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function resolveLocale(preferredLocales: readonly string[] | undefined): SupportedLocale {
    for (const locale of preferredLocales ?? []) {
        const normalizedLocale = locale.trim().toLowerCase();

        if (normalizedLocale === 'pl' || normalizedLocale.startsWith('pl-')) {
            return 'pl';
        }
    }

    return FALLBACK_LOCALE;
}

export function detectLocale(): SupportedLocale {
    return resolveLocale(typeof navigator === 'undefined' ? undefined : navigator.languages);
}
