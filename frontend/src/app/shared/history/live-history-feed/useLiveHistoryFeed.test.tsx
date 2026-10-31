import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { expect, it, vi } from 'vitest';

import { createHistorySession } from '../live-history-session';

import { useLiveHistoryFeed } from './useLiveHistoryFeed';

it('supports Home and End without intercepting modified keyboard shortcuts', () => {
    const history = {
        state: createHistorySession().getState(),
        loadOlder: vi.fn(),
        retry: vi.fn(),
        showNewest: vi.fn(),
        updateReadingPosition: vi.fn(),
    };
    const { result } = renderHook(() => useLiveHistoryFeed(history));
    const root = document.createElement('div');
    const scrollTo = vi.fn();
    Object.defineProperty(root, 'scrollHeight', { value: 900 });
    root.scrollTo = scrollTo;
    act(() => result.current.attachScrollRoot(root));
    const preventDefault = vi.fn();

    function event(key: string, ctrlKey = false) {
        const partial: Pick<
            KeyboardEvent<HTMLDivElement>,
            'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'preventDefault'
        > = {
            key,
            ctrlKey,
            altKey: false,
            metaKey: false,
            preventDefault,
        };

        return partial as KeyboardEvent<HTMLDivElement>;
    }

    act(() => result.current.handleHistoryKeyDown(event('End')));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 900, behavior: 'auto' });
    act(() => result.current.handleHistoryKeyDown(event('Home')));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' });
    expect(history.showNewest).toHaveBeenCalledOnce();
    act(() => result.current.handleHistoryKeyDown(event('Home', true)));
    expect(preventDefault).toHaveBeenCalledTimes(2);
});
