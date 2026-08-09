import type { ButtonHTMLAttributes } from 'react';

import styles from './ScenarioPanelAction.module.css';

export function ScenarioPanelAction({
    children,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button {...props} className={styles.button}>
            {children}
        </button>
    );
}
