import { afterEach, describe, expect, it } from 'vitest';

import { i18n, i18nReady, loadDevelopmentTranslations } from './index';

describe('application translation initialization', () => {
    afterEach(async () => {
        await i18n.changeLanguage('pl');
        await loadDevelopmentTranslations();
    });

    it('initializes Polish application resources and falls back for unsupported languages', async () => {
        await i18nReady;
        await i18n.changeLanguage('en-GB');

        expect(i18n.t('feed.hideSidebar', { ns: 'dashboard' })).toBe('Ukryj ostatnie zdarzenia');
        expect(i18n.t('availability.online', { ns: 'common' })).toBe('Online');
    });

    it('loads development resources on demand without replacing production translations', async () => {
        i18n.removeResourceBundle('pl', 'development');
        expect(i18n.hasResourceBundle('pl', 'development')).toBe(false);

        await loadDevelopmentTranslations();
        await loadDevelopmentTranslations();

        expect(i18n.t('scenarios.led.title', { ns: 'development' })).toBe('Scenariusze LED');
        expect(i18n.t('feed.hideSidebar', { ns: 'dashboard' })).toBe('Ukryj ostatnie zdarzenia');
        expect(i18n.t('actionCompleted', { ns: 'development', action: '<test>' })).toContain(
            '<test>',
        );
    });
});
