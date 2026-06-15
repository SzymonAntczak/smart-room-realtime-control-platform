import type { ReactNode } from 'react';
import styles from './ControlCard.module.css';

interface ControlCardProps {
    eyebrow: string;
    title: string;
    status: string;
    children: ReactNode;
    statusAriaLive?: 'off' | 'polite' | 'assertive';
    statusRole?: 'status';
    titleId?: string;
}

export function ControlCard({
    eyebrow,
    title,
    status,
    children,
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
                <span className={styles.status} role={statusRole} aria-live={statusAriaLive}>
                    {status}
                </span>
            </div>

            {children}
        </section>
    );
}
