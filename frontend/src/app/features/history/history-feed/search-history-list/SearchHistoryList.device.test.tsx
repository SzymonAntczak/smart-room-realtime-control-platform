import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HistorySearchState } from '../history-search-session';

import { SearchHistoryList } from './SearchHistoryList';

vi.mock('react-virtuoso', async () => {
    const { createElement } = await import('react');

    return {
        Virtuoso: ({
            data = [],
            endReached,
        }: {
            data?: readonly unknown[];
            endReached?: (index: number) => void;
        }) =>
            createElement(
                'div',
                { 'data-testid': 'mock-event-history-viewport' },
                createElement(
                    'button',
                    { onClick: () => endReached?.(data.length - 1) },
                    'Reach the end of the history',
                ),
                createElement('span', null, `${data.length} items`),
            ),
    };
});

const retry = vi.fn();
const refresh = vi.fn();
const loadOlder = vi.fn();

function makeState(overrides: Partial<HistorySearchState> = {}): HistorySearchState {
    return {
        status: 'ready',
        items: [],
        appliedCriteria: { deviceId: 'led-main' },
        displayedCriteria: { deviceId: 'led-main' },
        historyGenerationId: 'generation-1',
        throughSequence: 10,
        retentionAsOf: '2026-10-01T00:00:00Z',
        completeness: 'retained_evidence_only',
        nextCursor: null,
        endReached: true,
        lastKnown: false,
        refreshRequired: false,
        limitReached: false,
        error: null,
        sessionRevision: 0,
        ...overrides,
    };
}

describe('fixed-device history results', () => {
    beforeEach(() => vi.clearAllMocks());

    function view(state: HistorySearchState) {
        return (
            <SearchHistoryList
                state={state}
                devices={[]}
                scrollParent={document.createElement('div')}
                loadOlder={loadOlder}
                retry={retry}
                refresh={refresh}
                deviceScoped
            />
        );
    }

    it('shows empty device history', () => {
        render(view(makeState()));
        expect(screen.getByRole('status')).toHaveTextContent('Brak zachowanych wpisów');
    });
    it('ignores rendered-end callbacks and loads only from user scroll input without a paging button', async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            view(
                makeState({
                    items: [createUserHistoryFixtures().powerChange],
                    nextCursor: 'older-page',
                    endReached: false,
                }),
            ),
        );
        expect(
            screen.queryByRole('button', { name: /Wczytaj starsze wpisy/ }),
        ).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Reach the end of the history' }));
        expect(loadOlder).not.toHaveBeenCalled();
        const scroller = document.createElement('div');
        Object.defineProperties(scroller, {
            clientHeight: { value: 400 },
            scrollHeight: { value: 1000 },
            scrollTop: { value: 400, writable: true },
        });
        rerender(
            <SearchHistoryList
                state={makeState({
                    items: [createUserHistoryFixtures().powerChange],
                    nextCursor: 'older',
                    endReached: false,
                })}
                devices={[]}
                scrollParent={scroller}
                loadOlder={loadOlder}
                retry={retry}
                refresh={refresh}
                deviceScoped
            />,
        );
        fireEvent.scroll(scroller);
        expect(loadOlder).not.toHaveBeenCalled();
        fireEvent.wheel(scroller, { deltaY: 100 });
        fireEvent.scroll(scroller);
        expect(loadOlder).toHaveBeenCalledOnce();
        fireEvent.scroll(scroller);
        expect(loadOlder).toHaveBeenCalledOnce();
    });
    it('retries transient errors and explicitly refreshes invalidated device history', async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            view(makeState({ status: 'error', error: 'history_unavailable', endReached: false })),
        );
        await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
        expect(retry).toHaveBeenCalledOnce();
        rerender(
            view(
                makeState({
                    status: 'error',
                    error: 'cursor_expired',
                    refreshRequired: true,
                    endReached: false,
                }),
            ),
        );
        await user.click(screen.getByRole('button', { name: 'Odśwież historię' }));
        expect(refresh).toHaveBeenCalledOnce();
    });
});
