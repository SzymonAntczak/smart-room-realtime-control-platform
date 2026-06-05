import styles from './ConnectionIndicator.module.css';

interface ConnectionIndicatorProps {
    label: string;
    tone: 'neutral' | 'success' | 'warning' | 'danger';
}

export function ConnectionIndicator({ label, tone }: ConnectionIndicatorProps) {
    return (
        <div className={`${styles.indicator} ${styles[tone]}`} aria-label="Connection status">
            <span className={styles.dot} aria-hidden="true" />
            <span>{label}</span>
        </div>
    );
}
