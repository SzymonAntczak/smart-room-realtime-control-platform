import { useTranslation } from 'react-i18next';

export function RouteError() {
    const { t } = useTranslation('common');

    return (
        <main>
            <h1>{t('route.failed')}</h1>
            <p role="alert">{t('route.retryDescription')}</p>
            <a href={window.location.href}>{t('route.reload')}</a>
        </main>
    );
}
