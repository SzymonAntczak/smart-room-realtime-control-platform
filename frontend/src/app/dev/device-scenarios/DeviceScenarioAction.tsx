import type { ButtonHTMLAttributes } from 'react';

import styles from './DeviceScenarioAction.module.css';

export function DeviceScenarioAction({
    children,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button {...props} className={styles.button}>
            {children}
        </button>
    );
}
