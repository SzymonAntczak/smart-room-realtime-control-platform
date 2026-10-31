import type { DeviceScenarioResult } from '@smart-room/contracts/development';
import type { DurableDiagnosticsSnapshot } from '@smart-room/contracts/diagnostics';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '../../i18n';
import { ledScenarioDefinition, temperatureScenarioDefinition } from '../scenarios';

import type { DeviceScenarioClient } from './device-scenario-client';
import { useScenarioActionRequest } from './useScenarioActionRequest';

function deferred<T>() {
    let resolve: (value: T) => void = () => {
        throw new Error('Deferred promise not initialized');
    };

    let reject: (error: Error) => void = () => {
        throw new Error('Deferred promise not initialized');
    };

    const promise = new Promise<T>((complete, fail) => {
        resolve = complete;
        reject = fail;
    });

    return { promise, resolve, reject };
}

function clients() {
    const client = {
        getScenarios: vi.fn<DeviceScenarioClient['getScenarios']>(),
        runScenario: vi
            .fn<DeviceScenarioClient['runScenario']>()
            .mockImplementation(async (action) => ({ action, status: 'completed' })),
        getDiagnostics: vi
            .fn<DeviceScenarioClient['getDiagnostics']>()
            .mockResolvedValue({ historyGenerationId: 'generation-1', entries: [] }),
    };

    return client;
}

describe('scenario action requests', () => {
    it('ignores unavailable clients and actions outside the selected definition', async () => {
        const client = clients();
        const onRequestChange = vi.fn();
        const { result, rerender } = renderHook(
            ({ available }) =>
                useScenarioActionRequest({
                    client: available ? client : undefined,
                    definition: ledScenarioDefinition,
                    isCommandActive: false,
                    onRequestChange,
                }),
            { initialProps: { available: false } },
        );

        await act(() => result.current.runScenario('confirm_delayed'));
        rerender({ available: true });
        await act(() => result.current.runScenario('pause_telemetry'));
        await act(() => result.current.refreshDiagnostics());

        expect(client.runScenario).not.toHaveBeenCalled();
        expect(client.getDiagnostics).not.toHaveBeenCalled();
        expect(onRequestChange).not.toHaveBeenCalled();
    });

    it('tracks outstanding requests and clears a selected LED scenario when a command begins', async () => {
        const client = clients();
        const pending = deferred<DeviceScenarioResult>();
        client.runScenario.mockReturnValueOnce(pending.promise);
        const onRequestChange = vi.fn();
        const { result, rerender } = renderHook(
            ({ active }) =>
                useScenarioActionRequest({
                    client,
                    definition: ledScenarioDefinition,
                    isCommandActive: active,
                    onRequestChange,
                }),
            { initialProps: { active: false } },
        );
        let operation: Promise<void> | undefined;

        act(() => {
            operation = result.current.runScenario('confirm_delayed');
        });

        expect(result.current.activeAction).toBe('confirm_delayed');
        expect(onRequestChange).toHaveBeenCalledExactlyOnceWith(true);
        await act(async () => {
            pending.resolve({ action: 'confirm_delayed', status: 'completed' });
            await operation;
        });
        expect(result.current.activeAction).toBeUndefined();
        expect(result.current.message).toBe(
            i18n.t('actionSelected', {
                ns: 'development',
                action: i18n.t('scenarios.led.actions.confirmDelayed', { ns: 'development' }),
            }),
        );
        expect(onRequestChange.mock.calls).toEqual([[true], [false]]);

        rerender({ active: true });
        expect(result.current.message).toBeUndefined();
        rerender({ active: false });
        expect(result.current.message).toBeUndefined();
    });

    it('clears a previous selected outcome when immediate confirmation is selected', async () => {
        const client = clients();
        const { result } = renderHook(() =>
            useScenarioActionRequest({
                client,
                definition: ledScenarioDefinition,
                isCommandActive: false,
                onRequestChange: vi.fn(),
            }),
        );
        await act(() => result.current.runScenario('confirm_delayed'));
        expect(result.current.message).toBeDefined();

        await act(() => result.current.runScenario('confirm_immediately'));

        expect(result.current.message).toBeUndefined();
    });

    it('releases the request lock and allows a retry after a scenario failure', async () => {
        const client = clients();
        client.runScenario.mockRejectedValueOnce(new Error('Request failed'));
        const onRequestChange = vi.fn();
        const { result } = renderHook(() =>
            useScenarioActionRequest({
                client,
                definition: ledScenarioDefinition,
                isCommandActive: false,
                onRequestChange,
            }),
        );
        await act(() => result.current.runScenario('confirm_delayed'));
        expect(result.current.message).toBe(i18n.t('scenarioRequestFailed', { ns: 'development' }));
        expect(result.current.activeAction).toBeUndefined();
        expect(onRequestChange.mock.calls).toEqual([[true], [false]]);

        await act(() => result.current.runScenario('confirm_delayed'));

        expect(result.current.message).toBe(
            i18n.t('actionSelected', {
                ns: 'development',
                action: i18n.t('scenarios.led.actions.confirmDelayed', { ns: 'development' }),
            }),
        );
        expect(result.current.message).not.toContain(
            i18n.t('scenarioRequestFailed', { ns: 'development' }),
        );
    });

    it('reports completed temperature actions and refreshes diagnostics after success', async () => {
        const client = clients();
        const { result } = renderHook(() =>
            useScenarioActionRequest({
                client,
                definition: temperatureScenarioDefinition,
                isCommandActive: false,
                onRequestChange: vi.fn(),
            }),
        );

        await act(() => result.current.runScenario('pause_telemetry'));

        expect(result.current.message).toBe(
            i18n.t('actionCompleted', {
                ns: 'development',
                action: i18n.t('scenarios.temperature.actions.pause', { ns: 'development' }),
            }),
        );
        expect(client.getDiagnostics).toHaveBeenCalledOnce();
        expect(result.current.diagnostics).toEqual({
            historyGenerationId: 'generation-1',
            entries: [],
        });
        expect(result.current.isRefreshingDiagnostics).toBe(false);
    });

    it('keeps the latest diagnostics while ignoring an older failure', async () => {
        const client = clients();
        const older = deferred<DurableDiagnosticsSnapshot>();
        const newer = deferred<DurableDiagnosticsSnapshot>();
        client.getDiagnostics.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        const { result } = renderHook(() =>
            useScenarioActionRequest({
                client,
                definition: temperatureScenarioDefinition,
                isCommandActive: false,
                onRequestChange: vi.fn(),
            }),
        );
        let first: Promise<void> | undefined;
        let second: Promise<void> | undefined;
        act(() => {
            first = result.current.refreshDiagnostics();
            second = result.current.refreshDiagnostics();
        });
        expect(result.current.isRefreshingDiagnostics).toBe(true);

        await act(async () => {
            older.reject(new Error('Old request failed'));
            await first;
        });
        expect(result.current.isRefreshingDiagnostics).toBe(true);
        expect(result.current.diagnosticsErrorMessage).toBeUndefined();
        await act(async () => {
            newer.resolve({ historyGenerationId: 'generation-1', entries: [] });
            await second;
        });

        expect(result.current.diagnostics).toEqual({
            historyGenerationId: 'generation-1',
            entries: [],
        });
        expect(result.current.diagnosticsErrorMessage).toBeUndefined();
        expect(result.current.isRefreshingDiagnostics).toBe(false);
    });

    it('ignores an older successful refresh after newer diagnostics arrive', async () => {
        const client = clients();
        const older = deferred<DurableDiagnosticsSnapshot>();
        const latest = { historyGenerationId: 'generation-2', entries: [] };
        client.getDiagnostics.mockReturnValueOnce(older.promise).mockResolvedValueOnce(latest);
        const { result } = renderHook(() =>
            useScenarioActionRequest({
                client,
                definition: temperatureScenarioDefinition,
                isCommandActive: false,
                onRequestChange: vi.fn(),
            }),
        );
        let first: Promise<void> | undefined;
        act(() => {
            first = result.current.refreshDiagnostics();
        });
        await act(() => result.current.refreshDiagnostics());
        expect(result.current.diagnostics).toEqual(latest);

        await act(async () => {
            older.resolve({ historyGenerationId: 'generation-1', entries: [] });
            await first;
        });

        expect(result.current.diagnostics).toEqual(latest);
        expect(result.current.isRefreshingDiagnostics).toBe(false);
    });

    it('keeps last-known diagnostics on refresh failure and clears the error after retry', async () => {
        const client = clients();
        client.getDiagnostics
            .mockResolvedValueOnce({ historyGenerationId: 'generation-1', entries: [] })
            .mockRejectedValueOnce(new Error('Failed'));
        const { result } = renderHook(() =>
            useScenarioActionRequest({
                client,
                definition: temperatureScenarioDefinition,
                isCommandActive: false,
                onRequestChange: vi.fn(),
            }),
        );
        await act(() => result.current.refreshDiagnostics());
        await act(() => result.current.refreshDiagnostics());
        expect(result.current.diagnostics).toEqual({
            historyGenerationId: 'generation-1',
            entries: [],
        });
        expect(result.current.diagnosticsErrorMessage).toBe(
            i18n.t('diagnosticsRequestFailed', { ns: 'development' }),
        );
        expect(result.current.isRefreshingDiagnostics).toBe(false);

        await act(() => result.current.refreshDiagnostics());

        expect(result.current.diagnosticsErrorMessage).toBeUndefined();
    });
});
