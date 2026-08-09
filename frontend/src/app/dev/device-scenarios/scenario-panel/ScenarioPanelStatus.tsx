import type { ReactNode } from 'react';

import styles from './ScenarioPanelStatus.module.css';

export function ScenarioPanelStatus({ children }: { readonly children: ReactNode }) {
    return (
        <p className={styles.status} role="status">
            {children}
        </p>
    );
}
