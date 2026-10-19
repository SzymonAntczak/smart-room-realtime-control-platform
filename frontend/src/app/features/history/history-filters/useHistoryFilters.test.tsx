import { act, renderHook } from '@testing-library/react';
import type { FormEvent, ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { HistoryProvider } from '../HistoryProvider';

import { useHistoryFilters } from './useHistoryFilters';

afterEach(() => vi.unstubAllGlobals());

it('blocks reversed draft dates without applying criteria or requesting history', () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const wrapper = ({ children }: { children: ReactNode }) => (
        <HistoryProvider mode="search" devices={[]}>
            {children}
        </HistoryProvider>
    );
    const { result } = renderHook(() => useHistoryFilters(undefined), { wrapper });
    act(() => result.current.setForm({ deviceId: '', from: '2026-10-21', to: '2026-10-20' }));
    const preventDefault = vi.fn();
    const submit: Pick<FormEvent<HTMLFormElement>, 'preventDefault'> = { preventDefault };
    act(() => result.current.handleSubmit(submit as FormEvent<HTMLFormElement>));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(result.current.formError).toBe('range');
    expect(result.current.appliedForm).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
});
