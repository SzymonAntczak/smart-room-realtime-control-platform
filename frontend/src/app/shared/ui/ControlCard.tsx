import type { ReactNode } from 'react';

import styles from './ControlCard.module.css';

type ControlCardStatusTone = 'neutral' | 'success' | 'warning' | 'danger';

interface ControlCardProps {
    eyebrow: string;
    title: string;
    status: string;
    children: ReactNode;
    statusTone?: ControlCardStatusTone;
    statusAriaLive?: 'off' | 'polite' | 'assertive';
    statusRole?: 'status';
    titleId?: string;
}

export function ControlCard({
    eyebrow,
    title,
    status,
    children,
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
                    <h1 id={titleId}>{title}</h1>
                </div>
                <span
                    className={styles.status}
                    data-tone={statusTone}
                    role={statusRole}
                    aria-live={statusAriaLive}
                >
                    {status}
                </span>
            </div>

            {children}
        </section>
    );
}
