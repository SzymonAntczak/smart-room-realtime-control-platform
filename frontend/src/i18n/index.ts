import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { detectLocale, FALLBACK_LOCALE, SUPPORTED_LOCALES } from './locale';
import { pl } from './locales/pl';

export const i18nReady = i18n.use(initReactI18next).init({
    fallbackLng: FALLBACK_LOCALE,
    lng: detectLocale(),
    supportedLngs: SUPPORTED_LOCALES,
    resources: {
        pl,
    },
    interpolation: {
        escapeValue: false,
    },
});

export async function loadDevelopmentTranslations(): Promise<void> {
    const { developmentPl } = await import('./locales/development-pl');

    i18n.addResourceBundle('pl', 'development', developmentPl, true, true);
}

export { i18n };
