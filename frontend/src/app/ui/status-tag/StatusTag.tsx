import type { ReactNode } from 'react';

import styles from './StatusTag.module.css';

export type StatusTagTone = 'neutral' | 'success' | 'warning' | 'danger';

export function StatusTag({
    children,
    icon,
    tone = 'neutral',
    ariaLive = 'polite',
    role = 'status',
    testId,
}: {
    children: ReactNode;
    icon?: ReactNode;
    tone?: StatusTagTone;
    ariaLive?: 'off' | 'polite' | 'assertive';
    role?: 'status';
    testId?: string;
}) {
    return (
        <span
            className={styles.status}
            data-tone={tone}
            data-testid={testId}
            role={role}
            aria-live={ariaLive}
        >
            {icon}
            {children}
        </span>
    );
}
