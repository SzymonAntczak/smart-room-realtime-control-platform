import type { ReactNode } from 'react';

import styles from './ScenarioPanelSection.module.css';

interface ScenarioPanelSectionProps {
    readonly title: string;
    readonly children: ReactNode;
}

export function ScenarioPanelSection({ title, children }: ScenarioPanelSectionProps) {
    return (
        <section className={styles.section}>
            <h3>{title}</h3>
            {children}
        </section>
    );
}
