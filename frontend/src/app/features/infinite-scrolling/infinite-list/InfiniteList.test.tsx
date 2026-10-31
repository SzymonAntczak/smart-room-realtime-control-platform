import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef, type CSSProperties, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import type { InfiniteListHandle } from './infinite-list-handle';
import { InfiniteList } from './InfiniteList';

vi.mock('react-virtuoso', () => ({
    Virtuoso: ({
        data,
        itemContent,
        context,
        components,
    }: {
        data: readonly { id: string }[];
        itemContent(): null;
        context: { renderItem(item: { id: string }, index: number): ReactNode };
        components: {
            List: React.ComponentType<{ children: ReactNode; style: CSSProperties }>;
            Item: React.ComponentType<unknown>;
        };
    }) => {
        const List = components.List;

        // Geometry is verified in Playwright; this seam only renders visible content.
        return (
            <List style={{}}>
                {data.map((item, index) => (
                    <li key={item.id}>
                        {context.renderItem(item, index)}
                        {itemContent()}
                    </li>
                ))}
            </List>
        );
    },
}));

it('owns its accessible viewport, renders dedicated content and never pages just by mounting', () => {
    const more = vi.fn();
    const ref = createRef<InfiniteListHandle>();
    render(
        <InfiniteList
            ref={ref}
            items={[{ id: 'one' }]}
            getItemKey={(item) => item.id}
            renderItem={(item) => <strong>{item.id}</strong>}
            hasMore
            loading={false}
            endReached={false}
            onLoadMore={more}
            ariaLabel="Measurements"
            afterItems={<p>Continue scrolling</p>}
        />,
    );
    const viewport = screen.getByRole('region', { name: 'Measurements' });
    expect(viewport).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('listitem')).toHaveTextContent('one');
    expect(ref.current?.getViewport()).toBe(viewport);
    expect(more).not.toHaveBeenCalled();
    expect(screen.getByText('Continue scrolling')).toBeVisible();
    const scrollTo = vi.fn();
    Object.defineProperty(viewport, 'scrollTo', { value: scrollTo });
    act(() => {
        ref.current?.scrollToTop();
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
});

it('recovers focus when a local action disappears but respects focus moved outside', () => {
    const props = {
        items: [] as { id: string }[],
        getItemKey: (item: { id: string }) => item.id,
        renderItem: () => null,
        hasMore: false,
        loading: false,
        endReached: false,
        onLoadMore: vi.fn(),
        ariaLabel: 'Measurements',
    };
    const { rerender } = render(
        <>
            <InfiniteList {...props} afterItems={<button>Retry</button>} />
            <button>Outside</button>
        </>,
    );
    fireEvent.focusIn(screen.getByRole('button', { name: 'Retry' }));
    rerender(
        <>
            <InfiniteList {...props} />
            <button>Outside</button>
        </>,
    );
    expect(screen.getByRole('region')).toHaveFocus();
    rerender(
        <>
            <InfiniteList {...props} afterItems={<button>Retry</button>} />
            <button>Outside</button>
        </>,
    );
    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    screen.getByRole('button', { name: 'Outside' }).focus();
    rerender(
        <>
            <InfiniteList {...props} />
            <button>Outside</button>
        </>,
    );
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
});
