import { act, renderHook } from '@testing-library/react';
import type { FormEvent } from 'react';
import { expect, it, vi } from 'vitest';

import { useDeviceFilterForm } from './useDeviceFilterForm';

it('blocks reversed or consumer-invalid ranges before applying any criteria', () => {
    const apply = vi.fn();
    const validate = vi.fn(() => false);
    const { result } = renderHook(() =>
        useDeviceFilterForm({
            devices: [],
            fixedDeviceId: 'sensor',
            onApply: apply,
            onRefresh: vi.fn(),
            onClear: vi.fn(),
            validate,
        }),
    );
    act(() => result.current.setForm({ deviceId: 'sensor', from: '2026-10-21', to: '2026-10-20' }));
    const submit = { preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>;
    act(() => result.current.handleSubmit(submit));
    expect(validate).not.toHaveBeenCalled();
    expect(result.current.formError).toBe('range');
    act(() => result.current.setForm({ deviceId: 'sensor', from: '2026-10-20', to: '' }));
    act(() => result.current.handleSubmit(submit));
    expect(validate).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
});
