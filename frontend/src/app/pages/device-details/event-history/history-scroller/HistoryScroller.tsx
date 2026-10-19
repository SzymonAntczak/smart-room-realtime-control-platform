import { forwardRef, type Ref } from 'react';
import type { ContextProp, ScrollerProps } from 'react-virtuoso';

import type { EventHistoryContext } from '../event-history-context';

import styles from './HistoryScroller.module.css';

export const HistoryScroller = forwardRef<
    HTMLDivElement,
    ScrollerProps & ContextProp<EventHistoryContext>
>(function HistoryScroller(
    { children, context, style, tabIndex, ...props },
    ref: Ref<HTMLDivElement>,
) {
    return (
        <div
            {...props}
            ref={ref}
            style={style}
            tabIndex={tabIndex}
            role="region"
            aria-label={context.scrollLabel}
            data-testid="device-event-history-scroll"
        >
            {children}
            {context.endMessage === null ? null : (
                <p className={styles.endMessage} role="status">
                    {context.endMessage}
                </p>
            )}
        </div>
    );
});
