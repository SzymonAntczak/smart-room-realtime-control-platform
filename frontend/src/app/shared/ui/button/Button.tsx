import type { ComponentPropsWithRef } from 'react';
import { Link } from 'react-router';

import styles from './Button.module.css';

type ButtonVariant = 'text' | 'filled' | 'outlined';

const elements = { button: 'button', link: Link } as const;

type ButtonProps =
    | (ComponentPropsWithRef<'button'> & {
          as?: 'button';
          variant: ButtonVariant;
          to?: never;
      })
    | (ComponentPropsWithRef<typeof Link> & {
          as: 'link';
          variant?: ButtonVariant;
          disabled?: never;
      });

export function Button(props: ButtonProps) {
    if (props.as === 'link') {
        const { as: element, variant = 'outlined', className, ...linkProps } = props;
        const Element = elements[element];

        return <Element {...linkProps} className={buttonClassName(variant, className)} />;
    }

    const { as: element = 'button', variant, className, ...buttonProps } = props;
    const Element = elements[element];

    return <Element {...buttonProps} className={buttonClassName(variant, className)} />;
}

function buttonClassName(variant: ButtonVariant, className?: string): string {
    return `${styles.button} ${styles[variant]} ${className ?? ''}`.trim();
}
