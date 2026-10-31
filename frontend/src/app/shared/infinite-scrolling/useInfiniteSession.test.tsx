import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { useInfiniteSession } from './useInfiniteSession';

it('subscribes once and closes only its own local session', () => {
    const close = vi.fn();
    const unsubscribe = vi.fn();
    const snapshot = { status: 'idle' };
    const factory = vi.fn(() => ({
        getState: () => snapshot,
        subscribe: () => unsubscribe,
        close,
    }));
    const first = renderHook(() => useInfiniteSession(factory));
    const second = renderHook(() => useInfiniteSession(factory, false));
    expect(first.result.current.state).toBe(snapshot);
    act(() => {
        expect(second.result.current.getSession()).toBeNull();
    });
    second.unmount();
    expect(close).not.toHaveBeenCalled();
    first.unmount();
    expect(close).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
});
