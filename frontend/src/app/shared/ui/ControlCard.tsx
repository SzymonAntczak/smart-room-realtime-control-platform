import type { ReactNode } from 'react';

import { Alert } from './Alert';
import styles from './ControlCard.module.css';

type ControlCardStatusTone = 'neutral' | 'success' | 'warning' | 'danger';

interface ControlCardProps {
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
    testId: string;
}

export function ControlCard({
    title,
    status,
    statusIcon,
    headerAction,
    children,
    bottomAlert = <Alert />,
    statusTone = 'neutral',
    statusAriaLive = 'polite',
    statusRole = 'status',
    titleId,
    testId,
}: ControlCardProps) {
    return (
        <section className={styles.card} aria-labelledby={titleId} data-testid={testId}>
            <div className={styles.header}>
                <div>
                    <h2 id={titleId}>{title}</h2>
                </div>
                <div className={styles.headerActions}>
                    {headerAction}
                    <span
                        className={styles.status}
                        data-tone={statusTone}
                        data-testid={`${testId}-status`}
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
