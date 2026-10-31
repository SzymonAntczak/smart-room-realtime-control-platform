import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import styles from './Tag.module.css';

export type TagTone = 'neutral' | 'success' | 'warning' | 'danger';

export function Tag({
    children,
    icon,
    tone = 'neutral',
    className,
    testId,
    ...props
}: ComponentPropsWithoutRef<'span'> & {
    icon?: ReactNode;
    tone?: TagTone;
    testId?: string;
}) {
    return (
        <span
            {...props}
            className={[styles.tag, className].filter(Boolean).join(' ')}
            data-tone={tone}
            data-testid={testId}
        >
            {icon}
            {children}
        </span>
    );
}
