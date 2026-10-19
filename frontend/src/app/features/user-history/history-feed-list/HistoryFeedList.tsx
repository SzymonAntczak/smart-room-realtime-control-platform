import { forwardRef, type Ref } from 'react';
import type { ListProps } from 'react-virtuoso';

import styles from './HistoryFeedList.module.css';

export const HistoryFeedList = forwardRef<HTMLUListElement, ListProps<HTMLUListElement>>(
    function HistoryFeedList({ children, style, 'data-testid': testId }, ref) {
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
