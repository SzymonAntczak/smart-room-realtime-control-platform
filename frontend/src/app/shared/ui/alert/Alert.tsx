import { CircleAlert, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import styles from './Alert.module.css';

export type AlertVariant = 'info' | 'warning' | 'error';

export function Alert({
    message,
    variant = 'info',
    testId,
}: {
    message?: string;
    variant?: AlertVariant;
    testId?: string;
}) {
    const { t } = useTranslation('common');
    const displayMessage = message || t('alert.none');

    const Icon =
        variant === 'warning' ? TriangleAlert : variant === 'error' ? CircleAlert : undefined;

    return (
        <p
            className={styles.alert}
            data-testid={testId}
            data-variant={variant}
            role={variant === 'info' ? undefined : 'alert'}
        >
            {Icon ? <Icon aria-hidden="true" size={18} /> : null}
            <span>{displayMessage}</span>
        </p>
    );
}
