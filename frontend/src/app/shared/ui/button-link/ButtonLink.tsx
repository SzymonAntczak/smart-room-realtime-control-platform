import { Link, type LinkProps } from 'react-router';

import type { ButtonVariant } from '../button/Button';

import styles from './ButtonLink.module.css';

export function ButtonLink({
    variant = 'outlined',
    className,
    ...props
}: LinkProps & { variant?: ButtonVariant; className?: string }) {
    return (
        <Link
            {...props}
            className={`${styles.button} ${styles[variant]} ${className ?? ''}`.trim()}
        />
    );
}
