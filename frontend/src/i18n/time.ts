import { FALLBACK_LOCALE } from './locale';

export interface TimeFormatContext {
    readonly locale: string;
    readonly timeZone: string;
}

export function detectTimeFormatContext(): TimeFormatContext {
    const preferredLocales = typeof navigator === 'undefined' ? undefined : navigator.languages;
    const detectedTimeZone = safelyDetectTimeZone();

    return resolveTimeFormatContext({ preferredLocales, detectedTimeZone });
}

export function resolveTimeFormatContext({
    preferredLocales,
    detectedTimeZone,
}: {
    preferredLocales?: readonly string[];
    detectedTimeZone?: string;
}): TimeFormatContext {
    return {
        locale: resolveDisplayLocale(preferredLocales),
        timeZone: resolveTimeZone(detectedTimeZone),
    };
}

export function formatTimestamp(
    timestamp: string,
    context: TimeFormatContext = detectTimeFormatContext(),
): string {
    return new Intl.DateTimeFormat(context.locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZone: context.timeZone,
        timeZoneName: 'short',
    }).format(new Date(timestamp));
}

function safelyDetectTimeZone(): string | undefined {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        return undefined;
    }
}

function resolveDisplayLocale(preferredLocales: readonly string[] | undefined): string {
    for (const locale of preferredLocales ?? []) {
        if (!locale.trim()) {
            continue;
        }

        try {
            new Intl.DateTimeFormat(locale);

            return locale;
        } catch {
            // Try the next browser preference before using the application fallback.
        }
    }

    return FALLBACK_LOCALE;
}

function resolveTimeZone(detectedTimeZone: string | undefined): string {
    if (!detectedTimeZone?.trim()) {
        return 'UTC';
    }

    try {
        new Intl.DateTimeFormat(FALLBACK_LOCALE, { timeZone: detectedTimeZone });

        return detectedTimeZone;
    } catch {
        return 'UTC';
    }
}
