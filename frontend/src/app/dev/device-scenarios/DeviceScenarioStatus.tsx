import type { ReactNode } from 'react';

import styles from './DeviceScenarioStatus.module.css';

export function DeviceScenarioStatus({ children }: { readonly children: ReactNode }) {
    return (
        <p className={styles.status} role="status">
            {children}
        </p>
    );
}
