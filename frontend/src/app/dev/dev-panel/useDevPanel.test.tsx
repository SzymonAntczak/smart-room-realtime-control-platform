import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDevPanel } from './useDevPanel';

function deferredResponse() {
    let resolve: (value: Response) => void = () => {
        throw new Error('Deferred response is not initialized.');
    };

    const promise = new Promise<Response>((complete) => {
        resolve = complete;
    });

    return { promise, resolve: (value: Response) => resolve(value) };
}

describe('useDevPanel', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('hides the previous device actions while loading the replacement device', async () => {
        const pending = deferredResponse();
        vi.stubGlobal(
            'fetch',
            vi
                .fn<typeof fetch>()
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            deviceId: 'led-main',
                            scenarios: [{ action: 'confirm_delayed' }],
                        }),
                    ),
                )
                .mockReturnValueOnce(pending.promise),
        );
        const { result, rerender } = renderHook(({ deviceId }) => useDevPanel(deviceId), {
            initialProps: { deviceId: 'led-main' },
        });
        await waitFor(() => expect(result.current.actions).toEqual(['confirm_delayed']));

        rerender({ deviceId: 'temp-desk' });
        expect(result.current.actions).toBeUndefined();
        expect(result.current.loadError).toBeUndefined();
        await act(async () =>
            pending.resolve(
                new Response(
                    JSON.stringify({
                        deviceId: 'temp-desk',
                        scenarios: [{ action: 'pause_telemetry' }],
                    }),
                ),
            ),
        );
        await waitFor(() => expect(result.current.actions).toEqual(['pause_telemetry']));
    });

    it('ignores a late discovery failure from the previous device', async () => {
        const previous = deferredResponse();
        vi.stubGlobal(
            'fetch',
            vi
                .fn<typeof fetch>()
                .mockReturnValueOnce(previous.promise)
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            deviceId: 'temp-desk',
                            scenarios: [{ action: 'pause_telemetry' }],
                        }),
                    ),
                ),
        );
        const { result, rerender } = renderHook(({ deviceId }) => useDevPanel(deviceId), {
            initialProps: { deviceId: 'led-main' },
        });
        rerender({ deviceId: 'temp-desk' });
        await waitFor(() => expect(result.current.actions).toEqual(['pause_telemetry']));

        await act(async () => previous.resolve(new Response(null, { status: 503 })));
        expect(result.current.actions).toEqual(['pause_telemetry']);
        expect(result.current.loadError).toBeUndefined();
    });
});
