import type { ComponentPropsWithRef } from 'react';

import styles from './Button.module.css';

export type ButtonVariant = 'text' | 'filled' | 'outlined';

export function Button({
    variant,
    className,
    ...props
}: ComponentPropsWithRef<'button'> & { variant: ButtonVariant }) {
    return (
        <button
            {...props}
            className={`${styles.button} ${styles[variant]} ${className ?? ''}`.trim()}
        />
    );
}
