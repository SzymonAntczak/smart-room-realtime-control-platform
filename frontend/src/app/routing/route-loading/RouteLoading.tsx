import { useTranslation } from 'react-i18next';
import { useNavigation } from 'react-router';

export function RouteLoading({ initial = false }: { initial?: boolean }) {
    const { t } = useTranslation('common');
    const navigation = useNavigation();

    return initial || navigation.state !== 'idle' ? (
        <p role="status">{t('route.loading')}</p>
    ) : null;
}
