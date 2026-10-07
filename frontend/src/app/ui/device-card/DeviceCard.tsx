import type { ReactNode } from 'react';

import { Alert } from '../alert/Alert';

import styles from './DeviceCard.module.css';

type DeviceCardStatusTone = 'neutral' | 'success' | 'warning' | 'danger';

interface DeviceCardProps {
    title: string;
    status: string;
    statusIcon?: ReactNode;
    headerAction?: ReactNode;
    children: ReactNode;
    bottomAlert?: ReactNode;
    statusTone?: DeviceCardStatusTone;
    statusAriaLive?: 'off' | 'polite' | 'assertive';
    statusRole?: 'status';
    titleId?: string;
    testId: string;
}

export function DeviceCard({
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
}: DeviceCardProps) {
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
