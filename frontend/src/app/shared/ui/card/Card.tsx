import type { ComponentPropsWithoutRef } from 'react';

import styles from './Card.module.css';

export function Card({ className, children, ...props }: ComponentPropsWithoutRef<'section'>) {
    return (
        <section {...props} className={[styles.card, className].filter(Boolean).join(' ')}>
            {children}
        </section>
    );
}
