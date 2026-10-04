import { createRef } from 'react';

import type { UserHistorySessionState } from './user-history-session';

/** App transport/composition tests have no layout. Real range/geometry lives in Playwright. */
export function historyRenderingWithoutLayout({ state }: { state: UserHistorySessionState }) {
    return {
        listRef: createRef<HTMLOListElement>(),
        rows: state.items.map((item, index) => ({ key: item.recordId, index, start: index * 192 })),
        totalSize: state.items.length * 192,
        scrollMargin: 0,
        measureElement: () => undefined,
    };
}
