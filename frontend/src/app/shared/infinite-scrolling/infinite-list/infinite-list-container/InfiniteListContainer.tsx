import { forwardRef, type Ref } from 'react';
import type { ListProps } from 'react-virtuoso';

import styles from './InfiniteListContainer.module.css';

export const InfiniteListContainer = forwardRef<HTMLUListElement, ListProps<HTMLUListElement>>(
    function InfiniteListContainer({ children, style, 'data-testid': testId }, ref) {
        return (
            <ol
                className={styles.list}
                data-testid={testId}
                style={style}
                ref={ref as Ref<HTMLOListElement>}
            >
                {children}
            </ol>
        );
    },
);
