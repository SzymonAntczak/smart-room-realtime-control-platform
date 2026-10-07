import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useHistorySidebar } from './useHistorySidebar';

function viewport(initialMatches: boolean) {
    let matches = initialMatches;
    const listeners = new Set<() => void>();
    const media = {
        get matches() {
            return matches;
        },
        addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
        removeEventListener: vi.fn((_event: string, listener: () => void) =>
            listeners.delete(listener),
        ),
    };
    vi.stubGlobal(
        'matchMedia',
        vi.fn(() => media),
    );

    return {
        media,
        listeners,
        resize(narrow: boolean) {
            matches = narrow;

            for (const listener of listeners) {
                listener();
            }
        },
    };
}

describe('history sidebar viewport policy', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('follows viewport changes until the user chooses an explicit state', () => {
        const view = viewport(false);
        const { result } = renderHook(useHistorySidebar);
        expect(result.current.isOpen).toBe(true);

        act(() => view.resize(true));
        expect(result.current.isOpen).toBe(false);
        act(() => result.current.toggle());
        expect(result.current.isOpen).toBe(true);
        act(() => view.resize(false));
        act(() => view.resize(true));
        expect(result.current.isOpen).toBe(true);
        act(() => result.current.toggle());
        act(() => view.resize(false));
        expect(result.current.isOpen).toBe(false);
    });

    it('starts collapsed on narrow screens and releases its viewport listener on unmount', () => {
        const view = viewport(true);
        const { result, unmount } = renderHook(useHistorySidebar);
        expect(result.current.isOpen).toBe(false);
        expect(view.listeners.size).toBe(1);
        expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 48rem)');

        unmount();

        expect(view.listeners.size).toBe(0);
        expect(view.media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('remains usable when matchMedia is unavailable', () => {
        vi.stubGlobal('matchMedia', undefined);
        const { result } = renderHook(useHistorySidebar);
        expect(result.current.isOpen).toBe(true);

        act(() => result.current.toggle());

        expect(result.current.isOpen).toBe(false);
    });
});
