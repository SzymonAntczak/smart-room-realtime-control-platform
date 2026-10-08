import type { ComponentPropsWithRef, ReactNode } from 'react';

import { Button } from '../../../ui';

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
        <Button
            {...props}
            variant="outlined"
            className={`${variantClass} ${className ?? ''}`}
        >
            {children}
        </Button>
    );
}
