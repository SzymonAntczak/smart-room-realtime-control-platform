import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useLedCommandRequest } from './use-led-command-request';

const submitLedPowerCommand = vi.hoisted(() => vi.fn());

vi.mock('./led-command-client', () => ({ submitLedPowerCommand }));

describe('useLedCommandRequest', () => {
    it('sends only one command while the current HTTP request is unresolved', async () => {
        let resolveRequest:
            | ((value: { commandId: string; status: 'accepted' }) => void)
            | undefined;
        submitLedPowerCommand.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveRequest = resolve;
                }),
        );
        submitLedPowerCommand.mockResolvedValueOnce({ commandId: 'cmd-2', status: 'accepted' });
        const { result } = renderHook(() => useLedCommandRequest('led-main'));

        await act(async () => {
            void result.current.requestPower('on');
            void result.current.requestPower('on');
        });

        expect(submitLedPowerCommand).toHaveBeenCalledOnce();

        await act(async () => {
            resolveRequest?.({ commandId: 'cmd-1', status: 'accepted' });
        });
        await waitFor(() => expect(result.current.submitting).toBe(false));

        await act(async () => {
            await result.current.requestPower('off');
        });

        expect(submitLedPowerCommand).toHaveBeenCalledTimes(2);
    });
});
