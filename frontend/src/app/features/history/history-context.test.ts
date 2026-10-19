import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { useHistoryContext } from './history-context';

it('requires an explicitly scoped history provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
        expect(() => renderHook(useHistoryContext)).toThrow(
            'History components require HistoryProvider',
        );
    } finally {
        error.mockRestore();
    }
});
