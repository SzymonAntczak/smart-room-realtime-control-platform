import type { ComponentPropsWithRef, ReactNode } from 'react';

import styles from './DevPanelButton.module.css';

export function DevPanelButton({
    children,
    variant = 'action',
    className,
    ...props
}: ComponentPropsWithRef<'button'> & {
    children: ReactNode;
    variant?: 'action' | 'close' | 'trigger';
}) {
    const variantClass =
        variant === 'close' ? styles.close : variant === 'trigger' ? styles.trigger : styles.action;

    return (
        <button {...props} className={`${variantClass} ${className ?? ''}`}>
            {children}
        </button>
    );
}
