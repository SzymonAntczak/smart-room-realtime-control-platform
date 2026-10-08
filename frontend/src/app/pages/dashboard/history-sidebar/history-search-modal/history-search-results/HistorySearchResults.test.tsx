import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createHistorySearchSession } from '../history-search-session';

import { HistorySearchResults } from './HistorySearchResults';

vi.mock('react-virtuoso', () => ({
    Virtuoso: ({
        data,
        defaultItemHeight,
        endReached,
        minOverscanItemCount,
    }: {
        data: Array<{ recordId: string }>;
        defaultItemHeight: number;
        endReached: () => void;
        minOverscanItemCount: { top: number; bottom: number };
    }) => (
        <div
            data-testid="virtual-history"
            data-item-count={data.length}
            data-default-height={defaultItemHeight}
            data-overscan={`${minOverscanItemCount.top}:${minOverscanItemCount.bottom}`}
        >
            <span>{data[0]?.recordId}</span>
            <button type="button" onClick={endReached}>
                Reach end
            </button>
        </div>
    ),
}));

const idleState = createHistorySearchSession().getState();
const fixtures = createUserHistoryFixtures();

describe('HistorySearchResults', () => {
    it('shows the initial instruction and an empty-result state', () => {
        const { rerender } = render(
            <HistorySearchResults
                state={idleState}
                devices={[]}
                scrollParent={null}
                loadOlder={vi.fn()}
                retry={vi.fn()}
                refresh={vi.fn()}
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent(
            'Wybierz co najmniej jedno kryterium i rozpocznij wyszukiwanie.',
        );

        rerender(
            <HistorySearchResults
                state={{
                    ...idleState,
                    status: 'ready',
                    appliedCriteria: { deviceId: 'led-main' },
                    endReached: true,
                }}
                devices={[]}
                scrollParent={null}
                loadOlder={vi.fn()}
                retry={vi.fn()}
                refresh={vi.fn()}
            />,
        );
        expect(screen.getByText('Brak zdarzeń spełniających te kryteria.')).toBeInTheDocument();
    });

    it('does not display a completeness notice for retained-evidence results', () => {
        render(
            <HistorySearchResults
                state={{ ...idleState, status: 'ready', completeness: 'retained_evidence_only' }}
                devices={[]}
                scrollParent={null}
                loadOlder={vi.fn()}
                retry={vi.fn()}
                refresh={vi.fn()}
            />,
        );

        expect(screen.queryByRole('status')).toBeNull();
    });

    it('shows only loading feedback when a refresh retains earlier results', () => {
        const items = [{ ...fixtures.powerChange, recordId: 'retained-record' }];
        render(
            <HistorySearchResults
                state={{
                    ...idleState,
                    status: 'loading',
                    items,
                    endReached: true,
                    lastKnown: true,
                }}
                devices={[]}
                scrollParent={document.createElement('div')}
                loadOlder={vi.fn()}
                retry={vi.fn()}
                refresh={vi.fn()}
            />,
        );

        expect(screen.getByRole('status')).toHaveTextContent('Ładowanie historii');
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.queryByTestId('virtual-history')).toBeNull();
    });

    it('does not show a disabled load action when the page limit is reached', () => {
        render(
            <HistorySearchResults
                state={{
                    ...idleState,
                    status: 'ready',
                    nextCursor: 'older',
                    limitReached: true,
                }}
                devices={[]}
                scrollParent={null}
                loadOlder={vi.fn()}
                retry={vi.fn()}
                refresh={vi.fn()}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Wczytaj starsze' })).toBeNull();
    });

    it('exposes the explicit older-page action for the applied session', () => {
        const loadOlder = vi.fn().mockResolvedValue(undefined);
        render(
            <HistorySearchResults
                state={{
                    ...idleState,
                    status: 'ready',
                    appliedCriteria: { deviceId: 'led-main' },
                    nextCursor: 'older',
                }}
                devices={[]}
                scrollParent={null}
                loadOlder={loadOlder}
                retry={vi.fn().mockResolvedValue(undefined)}
                refresh={vi.fn().mockResolvedValue(undefined)}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Wczytaj starsze' }));
        expect(loadOlder).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: 'Odśwież wyniki' })).toBeNull();
    });

    it('requests a fresh session after cursor invalidation', () => {
        const retry = vi.fn().mockResolvedValue(undefined);
        const refresh = vi.fn().mockResolvedValue(undefined);
        render(
            <HistorySearchResults
                state={{
                    ...idleState,
                    status: 'error',
                    appliedCriteria: { deviceId: 'led-main' },
                    error: 'cursor_expired',
                    refreshRequired: true,
                    lastKnown: true,
                }}
                devices={[]}
                scrollParent={null}
                loadOlder={vi.fn()}
                retry={retry}
                refresh={refresh}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Odśwież wyniki' }));
        expect(refresh).toHaveBeenCalledOnce();
        expect(retry).not.toHaveBeenCalled();
    });

    it('shows loading feedback and retries an ordinary page error', () => {
        const retry = vi.fn().mockResolvedValue(undefined);
        const { rerender } = render(
            <HistorySearchResults
                state={{ ...idleState, status: 'loading' }}
                devices={[]}
                scrollParent={null}
                loadOlder={vi.fn()}
                retry={retry}
                refresh={vi.fn()}
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent('Ładowanie historii');

        rerender(
            <HistorySearchResults
                state={{ ...idleState, status: 'error', error: 'request_failed' }}
                devices={[]}
                scrollParent={null}
                loadOlder={vi.fn()}
                retry={retry}
                refresh={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
        expect(retry).toHaveBeenCalledOnce();
    });

    it('keeps the result list virtualized and requests another page at the end', () => {
        const items = Array.from({ length: 30 }, (_, index) => ({
            ...fixtures.powerChange,
            recordId: `record-${index}`,
        }));
        const loadOlder = vi.fn().mockResolvedValue(undefined);
        const { rerender } = render(
            <HistorySearchResults
                state={{
                    ...idleState,
                    status: 'ready',
                    items,
                    appliedCriteria: { deviceId: 'led-main' },
                    nextCursor: 'older',
                }}
                devices={[]}
                scrollParent={document.createElement('div')}
                loadOlder={loadOlder}
                retry={vi.fn()}
                refresh={vi.fn()}
            />,
        );

        const virtualList = screen.getByTestId('virtual-history');
        expect(virtualList).toHaveAttribute('data-item-count', '30');
        expect(virtualList).toHaveAttribute('data-default-height', '192');
        expect(virtualList).toHaveAttribute('data-overscan', '5:5');
        expect(virtualList).toHaveTextContent('record-0');
        expect(virtualList).not.toHaveTextContent('record-29');

        fireEvent.click(screen.getByRole('button', { name: 'Reach end' }));
        expect(loadOlder).toHaveBeenCalledOnce();

        rerender(
            <HistorySearchResults
                state={{
                    ...idleState,
                    status: 'ready',
                    items: [fixtures.powerChange],
                    appliedCriteria: { deviceId: 'led-main' },
                    endReached: true,
                }}
                devices={[]}
                scrollParent={document.createElement('div')}
                loadOlder={loadOlder}
                retry={vi.fn()}
                refresh={vi.fn()}
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent('Koniec dostępnego zakresu historii.');
    });

    it('resets the scroll position before refreshing results', () => {
        const scrollParent = document.createElement('div');
        Object.defineProperty(scrollParent, 'scrollTop', { value: 180, writable: true });
        const scrollTo = vi.fn(() => {
            scrollParent.scrollTop = 0;
        });
        scrollParent.scrollTo = scrollTo;
        const refresh = vi.fn().mockResolvedValue(undefined);
        render(
            <HistorySearchResults
                state={{
                    ...idleState,
                    status: 'error',
                    appliedCriteria: { deviceId: 'led-main' },
                    error: 'cursor_expired',
                    refreshRequired: true,
                }}
                devices={[]}
                scrollParent={scrollParent}
                loadOlder={vi.fn()}
                retry={vi.fn()}
                refresh={refresh}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Odśwież wyniki' }));
        expect(scrollParent.scrollTop).toBe(0);
        expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
        expect(refresh).toHaveBeenCalledOnce();
    });
});
