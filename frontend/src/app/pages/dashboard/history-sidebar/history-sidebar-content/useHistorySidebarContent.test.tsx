import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useHistorySidebarContent } from './useHistorySidebarContent';

afterEach(() => vi.useRealTimers());

it('owns top-button feedback and releases its tooltip timer on unmount', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(useHistorySidebarContent);
    const scrollToTop = vi.fn().mockReturnValue({ alreadyAtTop: true });
    result.current.feedRef.current = { scrollToTop };
    act(() => result.current.handleReturnToTop());
    expect(result.current.topTooltip).toBe(true);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(result.current.topTooltip).toBe(false);
    scrollToTop.mockReturnValue({ alreadyAtTop: false });
    act(() => result.current.handleReturnToTop());
    expect(result.current.topTooltip).toBe(false);
    scrollToTop.mockReturnValue({ alreadyAtTop: true });
    act(() => result.current.handleReturnToTop());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
});
