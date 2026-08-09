import type { ReactNode } from 'react';

import styles from './ScenarioPanel.module.css';

interface ScenarioPanelProps {
    readonly title: string;
    readonly description: string;
    readonly children: ReactNode;
}

export function ScenarioPanel({ title, description, children }: ScenarioPanelProps) {
    return (
        <section className={styles.panel}>
            <p className={styles.eyebrow}>Development only</p>
            <h2>{title}</h2>
            <p className={styles.description}>{description}</p>
            {children}
        </section>
    );
}
