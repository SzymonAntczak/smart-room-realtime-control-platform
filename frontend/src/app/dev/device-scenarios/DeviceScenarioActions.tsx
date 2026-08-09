import type { ReactNode } from 'react';

import styles from './DeviceScenarioActions.module.css';

export function DeviceScenarioActions({ children }: { readonly children: ReactNode }) {
    return <div className={styles.actions}>{children}</div>;
}
