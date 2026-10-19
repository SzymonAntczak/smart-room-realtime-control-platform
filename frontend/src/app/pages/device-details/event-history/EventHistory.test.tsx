import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HistorySearchState } from '../../../features/user-history';

import { EventHistory } from './EventHistory';
import { useDeviceEventHistory } from './useDeviceEventHistory';

vi.mock('./useDeviceEventHistory', () => ({ useDeviceEventHistory: vi.fn() }));
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

describe('device event history', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useDeviceEventHistory).mockReturnValue({
            state: makeState(),
            retry,
            refresh,
            loadOlder,
        });
    });

    it('explains retained evidence and shows the empty result state', () => {
        render(<EventHistory deviceId="led-main" deviceName="Główne LED" />);

        expect(
            screen.getByRole('heading', { name: 'Historia zdarzeń urządzenia' }),
        ).toBeInTheDocument();
        expect(screen.getByText(/dostępne zachowane wpisy/i)).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Brak zachowanych wpisów');
    });

    it('loads the next page when scrolling reaches the end without a paging button', async () => {
        const user = userEvent.setup();
        vi.mocked(useDeviceEventHistory).mockReturnValue({
            state: makeState({
                items: [createUserHistoryFixtures().powerChange],
                nextCursor: 'older-page',
                endReached: false,
            }),
            retry,
            refresh,
            loadOlder,
        });
        render(<EventHistory deviceId="led-main" deviceName="GĹ‚Ăłwne LED" />);

        expect(
            screen.queryByRole('button', { name: /Wczytaj starsze wpisy/ }),
        ).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Reach the end of the history' }));

        expect(loadOlder).toHaveBeenCalledOnce();
    });

    it('retries a failed request and refreshes when the cursor requires a new search', async () => {
        const user = userEvent.setup();
        vi.mocked(useDeviceEventHistory).mockReturnValue({
            state: makeState({ status: 'error', endReached: false, error: 'history_unavailable' }),
            retry,
            refresh,
            loadOlder,
        });
        const { rerender } = render(<EventHistory deviceId="led-main" deviceName="Główne LED" />);

        await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
        expect(retry).toHaveBeenCalledOnce();

        vi.mocked(useDeviceEventHistory).mockReturnValue({
            state: makeState({
                status: 'error',
                endReached: false,
                error: 'cursor_expired',
                refreshRequired: true,
            }),
            retry,
            refresh,
            loadOlder,
        });
        rerender(<EventHistory deviceId="led-main" deviceName="Główne LED" />);
        await user.click(screen.getByRole('button', { name: 'Odśwież historię' }));
        expect(refresh).toHaveBeenCalledOnce();
    });
});
