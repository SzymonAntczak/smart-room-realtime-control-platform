import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { createHistorySearchSession } from '../history-search-session';

import { HistoryResults } from './HistoryResults';

it('resets scroll only when the displayed search session is replaced', () => {
    const state = createHistorySearchSession().getState();
    const actions = { loadOlder: vi.fn(), retry: vi.fn(), refresh: vi.fn() };
    const { rerender } = render(<HistoryResults state={state} devices={[]} {...actions} />);
    const region = screen.getByRole('region');
    const scrollTo = vi.fn();
    Object.defineProperty(region, 'scrollTo', { configurable: true, value: scrollTo });
    rerender(<HistoryResults state={{ ...state, status: 'loading' }} devices={[]} {...actions} />);
    expect(scrollTo).not.toHaveBeenCalled();
    rerender(<HistoryResults state={{ ...state, sessionRevision: 1 }} devices={[]} {...actions} />);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: 'auto' });
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
});
