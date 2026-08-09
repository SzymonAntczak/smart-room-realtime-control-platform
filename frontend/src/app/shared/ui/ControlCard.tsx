import type { ReactNode } from 'react';

import styles from './ControlCard.module.css';

type ControlCardStatusTone = 'neutral' | 'success' | 'warning' | 'danger';

interface ControlCardProps {
    eyebrow: string;
    title: string;
    status: string;
    statusIcon?: ReactNode;
    headerAction?: ReactNode;
    children: ReactNode;
    bottomAlert?: ReactNode;
    statusTone?: ControlCardStatusTone;
    statusAriaLive?: 'off' | 'polite' | 'assertive';
    statusRole?: 'status';
    titleId?: string;
}

export function ControlCard({
    eyebrow,
    title,
    status,
    statusIcon,
    headerAction,
    children,
    bottomAlert,
    statusTone = 'neutral',
    statusAriaLive = 'polite',
    statusRole = 'status',
    titleId,
}: ControlCardProps) {
    return (
        <section className={styles.card} aria-labelledby={titleId}>
            <div className={styles.header}>
                <div>
                    <p className={styles.eyebrow}>{eyebrow}</p>
                    <h2 id={titleId}>{title}</h2>
                </div>
                <div className={styles.headerActions}>
                    {headerAction}
                    <span
                        className={styles.status}
                        data-tone={statusTone}
                        role={statusRole}
                        aria-live={statusAriaLive}
                    >
                        {statusIcon}
                        {status}
                    </span>
                </div>
            </div>

            <div className={styles.body}>{children}</div>
            <div className={styles.bottomAlert}>{bottomAlert}</div>
        </section>
    );
}
