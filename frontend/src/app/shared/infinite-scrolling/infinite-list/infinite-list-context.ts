import type { ReactNode } from 'react';

export interface InfiniteListContext<T> {
    renderItem(item: T, index: number): ReactNode;
    getItemTestId?: (item: T) => string;
    endReached: boolean;
    totalItems: number;
}
