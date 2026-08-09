import type { ReactNode } from 'react';

import styles from './DeviceScenarioSection.module.css';

interface DeviceScenarioSectionProps {
    readonly title: string;
    readonly children: ReactNode;
}

export function DeviceScenarioSection({ title, children }: DeviceScenarioSectionProps) {
    return (
        <section className={styles.section}>
            <h3>{title}</h3>
            {children}
        </section>
    );
}
