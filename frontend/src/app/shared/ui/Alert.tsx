import { CircleAlert, TriangleAlert } from 'lucide-react';

import styles from './Alert.module.css';

export type AlertVariant = 'info' | 'warning' | 'error';

export function Alert({ message, variant = 'info' }: { message?: string; variant?: AlertVariant }) {
    const displayMessage = message ?? 'No current alerts.';

    const Icon =
        variant === 'warning' ? TriangleAlert : variant === 'error' ? CircleAlert : undefined;

    return (
        <p
            className={styles.alert}
            data-variant={variant}
            role={variant === 'info' ? undefined : 'alert'}
        >
            {Icon ? <Icon aria-hidden="true" size={18} /> : null}
            <span>{displayMessage}</span>
        </p>
    );
}
