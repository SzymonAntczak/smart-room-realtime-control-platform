import type { UserHistoryItem } from '@smart-room/contracts/user-history';
import { isUserHistoryItem } from '@smart-room/contracts/user-history';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { createElement, createRef } from 'react';
import type { Components, ContextProp, ItemProps, ListProps } from 'react-virtuoso';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHistorySession } from '../history-session';

import { HistoryFeed } from './HistoryFeed';

const hooks = vi.hoisted(() => ({ virtualize: vi.fn(), paging: vi.fn(), virtuosoProps: vi.fn() }));
vi.mock('./useHistoryVirtualizer', () => ({ useHistoryVirtualizer: hooks.virtualize }));
vi.mock('./useHistoryPaging', () => ({ useHistoryPaging: hooks.paging }));
interface TestContext {
    devices: [];
    endReached: boolean;
    totalItems: number;
}
vi.mock('react-virtuoso', () => ({
    Virtuoso: ({
        data = [],
        components,
        context,
        endReached,
        increaseViewportBy,
        rangeChanged,
    }: {
        data?: readonly UserHistoryItem[];
        components: Components<UserHistoryItem, TestContext>;
        context: TestContext;
        endReached?: (index: number) => void;
        increaseViewportBy?: { top: number; bottom: number };
        rangeChanged?: (range: { startIndex: number; endIndex: number }) => void;
    }) => {
        hooks.virtuosoProps({ endReached, increaseViewportBy, rangeChanged });
        const List = components.List as ComponentType<ListProps<HTMLUListElement>>;
        const Item = components.Item as ComponentType<
            ItemProps<UserHistoryItem> & ContextProp<TestContext>
        >;

        return createElement(
            List,
            { 'data-testid': 'history-list', style: { height: data.length * 192 } },
            ...data.map((item, index) =>
                createElement(Item, {
                    key: item.recordId,
                    item,
                    'data-index': index,
                    'data-item-index': index,
                    'data-known-size': 192,
                    style: { transform: `translateY(${index * 192}px)` },
                    context,
                }),
            ),
        );
    },
}));

const fixtures = createUserHistoryFixtures();
const props = {
    state: {
        ...createHistorySession().getState(),
        status: 'ready' as const,
        items: [fixtures.powerChange, fixtures.availabilityChange, fixtures.healthChange].map(
            (item, index) => ({
                ...item,
                recordId: `rec:v1:sha256:${String(index + 1).repeat(64)}`,
            }),
        ),
        endReached: false,
    },
    devices: [],
    realtimeUncertain: false,
    scrollRoot: createRef<HTMLElement>(),
    customScrollParent: null,
    returningToTop: false,
    updateReadingPosition: vi.fn(),
    loadOlder: vi.fn(),
};

describe('HistoryFeed Virtuoso integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hooks.virtualize.mockReturnValue({
            virtuosoRef: createRef(),
        });
    });

    it('passes the full keyed data set and preserves list semantics and accessible row positions', () => {
        props.state.items.forEach((item) => expect(isUserHistoryItem(item)).toBe(true));
        const { rerender } = render(<HistoryFeed {...props} />);
        const rows = screen.getAllByRole('listitem');
        const row = rows[0];
        expect(rows).toHaveLength(3);
        expect(row).toHaveAttribute(
            'data-testid',
            `history-item-${props.state.items[0]?.recordId}`,
        );
        expect(row).toHaveAttribute('aria-posinset', '1');
        expect(row).toHaveAttribute('aria-setsize', '-1');
        expect(row).toHaveStyle({ transform: 'translateY(0px)' });
        expect(screen.getByRole('list')).toHaveStyle({ height: '576px' });

        rerender(<HistoryFeed {...props} state={{ ...props.state, endReached: true }} />);

        expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-setsize', '3');
    });

    it('connects scroll paging to the session loader without rendered-range paging callbacks', () => {
        render(<HistoryFeed {...props} />);
        expect(hooks.paging).toHaveBeenLastCalledWith(
            expect.objectContaining({
                loadOlder: props.loadOlder,
                scrollViewport: props.customScrollParent,
            }),
        );
        expect(hooks.virtuosoProps).toHaveBeenLastCalledWith({
            endReached: undefined,
            increaseViewportBy: undefined,
            rangeChanged: undefined,
        });
    });

    it('labels last-known and empty history without inventing rows', () => {
        render(<HistoryFeed {...props} state={{ ...props.state, items: [] }} realtimeUncertain />);

        expect(
            screen.getByText(
                'Strumień łączy się ponownie. Wyświetlane są ostatnio znane zdarzenia.',
            ),
        ).toBeInTheDocument();
        expect(screen.getByText('Brak istotnych zdarzeń.')).toBeInTheDocument();
        expect(screen.queryByRole('listitem')).toBeNull();
    });
});
