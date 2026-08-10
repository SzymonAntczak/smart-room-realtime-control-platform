import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { detectLocale, FALLBACK_LOCALE, SUPPORTED_LOCALES } from './locale';
import { pl } from './locales/pl';

void i18n.use(initReactI18next).init({
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

export { i18n };
