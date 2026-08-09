import type { ReactNode } from 'react';

import styles from './ScenarioPanelActions.module.css';

export function ScenarioPanelActions({ children }: { readonly children: ReactNode }) {
    return <div className={styles.actions}>{children}</div>;
}
