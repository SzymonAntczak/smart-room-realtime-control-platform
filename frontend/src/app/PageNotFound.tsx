import { useTranslation } from 'react-i18next';

export function PageNotFound() {
    const { t } = useTranslation('deviceDetails');

    return (
        <main>
            <h1>{t('pageNotFound')}</h1>
            <a href="/">{t('back')}</a>
        </main>
    );
}
