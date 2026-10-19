import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: vi.fn(), close: vi.fn(), loadOlder: vi.fn() }));

vi.mock('../../../features/user-history', () => ({
    createHistorySearchSession: () => ({
        getState: () => ({ status: 'idle' }),
        subscribe: () => () => undefined,
        search: mocks.search,
        loadOlder: mocks.loadOlder,
        retry: vi.fn(),
        close: mocks.close,
    }),
}));

import { useDeviceEventHistory } from './useDeviceEventHistory';

describe('useDeviceEventHistory', () => {
    beforeEach(() => vi.clearAllMocks());

    it('starts a bounded search for the selected LED and closes it on unmount', async () => {
        const { unmount } = renderHook(() => useDeviceEventHistory('led-main'));

        await waitFor(() => expect(mocks.search).toHaveBeenCalledWith({ deviceId: 'led-main' }));
        act(() => unmount());
        expect(mocks.close).toHaveBeenCalledOnce();
    });
});
