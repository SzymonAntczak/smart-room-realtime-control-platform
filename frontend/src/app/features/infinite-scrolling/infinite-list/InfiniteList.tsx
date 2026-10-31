import {
    type ReactNode,
    type Ref,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from 'react';
import { type Components, Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import { useInfiniteScroll } from '../useInfiniteScroll';

import { InfiniteListContainer } from './infinite-list-container/InfiniteListContainer';
import type { InfiniteListContext } from './infinite-list-context';
import type { InfiniteListHandle } from './infinite-list-handle';
import { InfiniteListRow } from './infinite-list-row/InfiniteListRow';
import styles from './InfiniteList.module.css';

export function InfiniteList<T>({
    items,
    getItemKey,
    renderItem,
    hasMore,
    loading,
    endReached,
    onLoadMore,
    ariaLabel,
    defaultItemHeight = 192,
    scrollParent,
    suspended = false,
    beforeItems,
    afterItems,
    getItemTestId,
    ref,
}: {
    items: readonly T[];
    getItemKey(item: T): string;
    renderItem(item: T, index: number): ReactNode;
    hasMore: boolean;
    loading: boolean;
    endReached: boolean;
    onLoadMore(): void | Promise<void>;
    ariaLabel: string;
    defaultItemHeight?: number;
    scrollParent?: HTMLElement | null;
    suspended?: boolean;
    beforeItems?: ReactNode;
    afterItems?: ReactNode;
    getItemTestId?: (item: T) => string;
    ref?: Ref<InfiniteListHandle>;
}) {
    const [localViewport, setLocalViewport] = useState<HTMLDivElement | null>(null);
    const viewport = scrollParent === undefined ? localViewport : scrollParent;
    const virtuoso = useRef<VirtuosoHandle | null>(null);
    const focused = useRef<HTMLElement | null>(null);
    const loadOlder = useCallback(() => {
        void onLoadMore();
    }, [onLoadMore]);
    useInfiniteScroll({
        canLoadMore: hasMore,
        loading,
        scrollViewport: viewport,
        loadOlder,
        returningToTop: suspended,
    });
    useImperativeHandle(
        ref,
        () => ({
            getViewport: () => viewport,
            scrollToTop() {
                const alreadyAtTop = !viewport || viewport.scrollTop <= 1;
                viewport?.scrollTo?.({ top: 0, behavior: 'auto' });

                return { alreadyAtTop };
            },
            scrollToIndex(location) {
                virtuoso.current?.scrollToIndex(location);
            },
        }),
        [viewport],
    );
    useEffect(() => {
        if (!viewport) {
            return;
        }

        const focusIn = (event: FocusEvent) => {
            focused.current = event.target instanceof HTMLElement ? event.target : null;
        };

        const focusOut = (event: FocusEvent) => {
            if (event.relatedTarget instanceof Node && !viewport.contains(event.relatedTarget)) {
                focused.current = null;
            }
        };

        const pointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && !viewport.contains(event.target)) {
                focused.current = null;
            }
        };

        viewport.addEventListener('focusin', focusIn);
        viewport.addEventListener('focusout', focusOut);
        viewport.ownerDocument.addEventListener('pointerdown', pointerDown, true);

        return () => {
            viewport.removeEventListener('focusin', focusIn);
            viewport.removeEventListener('focusout', focusOut);
            viewport.ownerDocument.removeEventListener('pointerdown', pointerDown, true);
        };
    }, [viewport]);
    useEffect(() => {
        const element = focused.current;

        if (
            element &&
            (!element.isConnected ||
                (element instanceof HTMLButtonElement &&
                    element.disabled &&
                    document.activeElement !== element))
        ) {
            viewport?.focus({ preventScroll: true });
            focused.current = viewport;
        }
    });
    const components: Components<T, InfiniteListContext<T>, HTMLUListElement> = {
        List: InfiniteListContainer,
        Item: InfiniteListRow,
    };
    const content = (
        <>
            {beforeItems}
            {viewport && items.length > 0 ? (
                <Virtuoso
                    ref={virtuoso}
                    data={items}
                    customScrollParent={viewport}
                    components={components}
                    context={{ renderItem, getItemTestId, endReached, totalItems: items.length }}
                    computeItemKey={(_index, item) => getItemKey(item)}
                    defaultItemHeight={defaultItemHeight}
                    minOverscanItemCount={{ top: 5, bottom: 5 }}
                    itemContent={() => null}
                />
            ) : null}
            {afterItems}
        </>
    );

    return scrollParent === undefined ? (
        <div
            className={styles.viewport}
            ref={setLocalViewport}
            role="region"
            aria-label={ariaLabel}
            tabIndex={0}
        >
            {content}
        </div>
    ) : (
        content
    );
}
