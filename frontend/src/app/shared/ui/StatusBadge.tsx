import styles from './StatusBadge.module.css';

interface StatusBadgeProps {
    label: string;
    tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

export function StatusBadge({ label, tone }: StatusBadgeProps) {
    return <span className={`${styles.badge} ${styles[tone]}`}>{label}</span>;
}
