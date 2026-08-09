import type { ReactNode } from 'react';

import styles from './DeviceScenarioPanel.module.css';

interface DeviceScenarioPanelProps {
    readonly title: string;
    readonly description: string;
    readonly children: ReactNode;
}

export function DeviceScenarioPanel({ title, description, children }: DeviceScenarioPanelProps) {
    return (
        <section className={styles.panel}>
            <p className={styles.eyebrow}>Development only</p>
            <h2>{title}</h2>
            <p className={styles.description}>{description}</p>
            {children}
        </section>
    );
}
