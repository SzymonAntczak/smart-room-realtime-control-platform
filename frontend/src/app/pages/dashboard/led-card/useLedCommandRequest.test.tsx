import {
    type AcceptedCommandResponse,
    acceptedCommandResponseSchema,
    type ActiveCommandProjection,
    preAdmissionCommandErrorResponseSchema,
    type RejectedCommandResponse,
    rejectedCommandResponseSchema,
    type TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import {
    activeCommandProjectionSchema,
    terminalCommandProjectionSchema,
} from '@smart-room/contracts/projections';
import { isSchema } from '@smart-room/contracts/validation';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createConfirmedCommand,
    createPendingCommand,
} from '../../../../test/room/room-realtime-fixtures';

import { useLedCommandRequest } from './useLedCommandRequest';

const submitLedPowerCommand = vi.hoisted(() => vi.fn());
const accepted: AcceptedCommandResponse = {
    commandId: 'cmd-1',
    status: 'accepted',
    durability: 'durable',
    lifecycleDurability: 'durable',
};
const rejected: RejectedCommandResponse = {
    commandId: 'cmd-1',
    status: 'rejected',
    reason: 'device_offline',
    message: 'Device is offline.',
    durability: 'volatile',
    lifecycleDurability: 'volatile',
};

interface Props {
    deviceId: string | undefined;
    active?: ActiveCommandProjection;
    recent?: readonly TerminalCommandProjection[];
}

function requestHook(initialProps: Props = { deviceId: 'led-main' }) {
    return renderHook(
        ({ deviceId, active, recent }: Props) => {
            if (active) {
                expect(isSchema(activeCommandProjectionSchema, active)).toBe(true);
            }

            for (const command of recent ?? []) {
                expect(isSchema(terminalCommandProjectionSchema, command)).toBe(true);
            }

            return useLedCommandRequest(deviceId, active, recent);
        },
        { initialProps },
    );
}

function deferred<T>() {
    let resolve: (value: T) => void = () => {
        throw new Error('Promise was not initialized.');
    };

    const promise = new Promise<T>((release) => {
        resolve = release;
    });

    return { promise, resolve };
}

vi.mock('../../../api/commands', () => ({ submitLedPowerCommand }));

describe('useLedCommandRequest', () => {
    beforeEach(() => {
        submitLedPowerCommand.mockReset();
        expect(isSchema(acceptedCommandResponseSchema, accepted)).toBe(true);
        expect(isSchema(rejectedCommandResponseSchema, rejected)).toBe(true);
    });

    it('sends only one command while the current HTTP request is unresolved', async () => {
        const pending = deferred<AcceptedCommandResponse>();
        submitLedPowerCommand.mockReturnValueOnce(pending.promise);
        submitLedPowerCommand.mockResolvedValueOnce(accepted);
        const { result } = requestHook();

        await act(async () => {
            void result.current.requestPower('on');
            void result.current.requestPower('on');
        });

        expect(submitLedPowerCommand).toHaveBeenCalledOnce();
        expect(result.current.admissionEvidence).toBeUndefined();
        expect(result.current.correlatedCommand).toBeUndefined();

        await act(async () => {
            pending.resolve(accepted);
        });
        expect(result.current.submitting).toBe(false);

        await act(async () => {
            await result.current.requestPower('off');
        });

        expect(submitLedPowerCommand).toHaveBeenCalledTimes(2);
    });

    it('retains a volatile rejection as admission evidence before its projection arrives', async () => {
        submitLedPowerCommand.mockResolvedValue(rejected);
        const { result } = requestHook();
        await act(async () => {
            await result.current.requestPower('on');
        });
        expect(result.current.admissionEvidence).toEqual(rejected);
        expect(result.current.transportError).toBeUndefined();
        expect(result.current.correlatedCommand).toBeUndefined();
    });

    it.each(['HTTP first', 'SSE first'])(
        'prefers a retained same-ID terminal projection with %s',
        async (order) => {
            const pending = deferred<AcceptedCommandResponse>();
            submitLedPowerCommand.mockReturnValueOnce(pending.promise);
            const { result, rerender } = requestHook();
            await act(async () => {
                void result.current.requestPower('on');
            });
            const terminal = {
                ...createConfirmedCommand(),
                lifecycleDurability: 'volatile' as const,
            };

            if (order === 'HTTP first') {
                await act(async () => {
                    pending.resolve(accepted);
                });
                expect(result.current.admissionEvidence).toEqual(accepted);
            }

            rerender({ deviceId: 'led-main', recent: [terminal] });

            if (order === 'SSE first') {
                await act(async () => {
                    pending.resolve(accepted);
                });
            }

            expect(result.current.admissionEvidence).toBeUndefined();
            expect(result.current.correlatedCommand).toEqual(terminal);
            rerender({ deviceId: 'led-main', recent: [] });
            expect(result.current.admissionEvidence).toBeUndefined();
            expect(result.current.correlatedCommand).toBeUndefined();
        },
    );

    it('reconciles admission against an active projection without rewriting its lifecycle', async () => {
        submitLedPowerCommand.mockResolvedValue(accepted);
        const { result, rerender } = requestHook();
        await act(async () => {
            await result.current.requestPower('on');
        });
        const active = { ...createPendingCommand(), lifecycleDurability: 'volatile' as const };
        rerender({ deviceId: 'led-main', active });
        expect(result.current.correlatedCommand).toEqual(active);
        expect(result.current.admissionEvidence).toBeUndefined();
    });

    it('finds a rejected attempt even when its terminal projection is not the newest', async () => {
        submitLedPowerCommand.mockResolvedValue(rejected);
        const { result, rerender } = requestHook();
        await act(async () => {
            await result.current.requestPower('on');
        });
        const failed: TerminalCommandProjection = {
            commandId: rejected.commandId,
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
            requestedAt: '2026-06-08T09:30:00Z',
            status: 'failed',
            failedAt: '2026-06-08T09:30:01Z',
            reason: rejected.reason,
            message: rejected.message,
            durability: 'volatile',
            lifecycleDurability: 'durable',
        };
        rerender({
            deviceId: 'led-main',
            recent: [{ ...createConfirmedCommand(), commandId: 'cmd-newer' }, failed],
        });
        expect(result.current.correlatedCommand).toEqual(failed);
        expect(result.current.admissionEvidence).toBeUndefined();
    });

    it('clears admission on the next request and on a device switch', async () => {
        const pending = deferred<AcceptedCommandResponse>();
        submitLedPowerCommand.mockResolvedValueOnce(accepted).mockReturnValueOnce(pending.promise);
        const { result, rerender } = requestHook();
        await act(async () => {
            await result.current.requestPower('on');
        });
        expect(result.current.admissionEvidence).toEqual(accepted);
        await act(async () => {
            void result.current.requestPower('off');
        });
        expect(result.current.admissionEvidence).toBeUndefined();
        rerender({ deviceId: 'led-second' });
        expect(result.current.submitting).toBe(false);
        await act(async () => {
            pending.resolve(accepted);
        });
        expect(result.current.admissionEvidence).toBeUndefined();
        submitLedPowerCommand.mockResolvedValue(rejected);
        await act(async () => {
            await result.current.requestPower('on');
        });
        expect(result.current.admissionEvidence).toEqual(rejected);
        rerender({ deviceId: 'led-main' });
        expect(result.current.admissionEvidence).toBeUndefined();
    });

    it.each(['pre-admission', 'network'])(
        'does not assign command evidence to a %s error',
        async (kind) => {
            const error = { error: 'unknown_device', message: 'Unknown device.' };
            expect(isSchema(preAdmissionCommandErrorResponseSchema, error)).toBe(true);

            if (kind === 'pre-admission') {
                submitLedPowerCommand.mockResolvedValue(error);
            } else {
                submitLedPowerCommand.mockRejectedValue(new Error('Disconnected'));
            }

            const { result } = requestHook();
            await act(async () => {
                await result.current.requestPower('on');
            });
            expect(result.current.transportError).toBeTruthy();
            expect(result.current.admissionEvidence).toBeUndefined();
            expect(result.current.correlatedCommand).toBeUndefined();
        },
    );

    it('allows a fresh request after switching away and back while the old HTTP request remains pending', async () => {
        const pending = deferred<AcceptedCommandResponse>();
        submitLedPowerCommand.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(rejected);
        const { result, rerender } = requestHook();
        await act(async () => {
            void result.current.requestPower('on');
        });
        rerender({ deviceId: 'led-second' });
        rerender({ deviceId: 'led-main' });
        await act(async () => {
            await result.current.requestPower('off');
        });
        expect(submitLedPowerCommand).toHaveBeenCalledTimes(2);
        expect(result.current.admissionEvidence).toEqual(rejected);
        await act(async () => {
            pending.resolve(accepted);
        });
        expect(result.current.admissionEvidence).toEqual(rejected);
    });
});
