import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockEventSource } from '../../../test/room/mock-event-source';
import {
    createInvalidRenderableDevices,
    createRoomSnapshotMessage,
} from '../../../test/room/room-realtime-fixtures';

import { useRoom } from './useRoom';

describe('dashboard room composition', () => {
    beforeEach(() => {
        MockEventSource.instances.length = 0;
        vi.stubGlobal('EventSource', MockEventSource);
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it.each(createInvalidRenderableDevices())(
        'rejects $label before publishing history or the room view',
        ({ device }) => {
            const { result, unmount } = renderHook(useRoom);
            const listener = vi.fn();
            result.current.historySource.subscribe(listener);

            act(() =>
                MockEventSource.latest().emitMessage(
                    createRoomSnapshotMessage({ devices: [device] }),
                ),
            );

            expect(result.current.room.status).toBe('connecting');
            expect(result.current.room.contractError).toBeDefined();
            expect(result.current.room.connectionStatus).toBe('reconnecting');
            expect(result.current.historySource.getBaseline()).toBeUndefined();
            expect(listener).toHaveBeenCalledExactlyOnceWith({ kind: 'interrupted' });
            unmount();
        },
    );

    it('publishes history synchronously before the new room view is rendered', () => {
        const { result, unmount } = renderHook(useRoom);
        const source = result.current.historySource;
        const listener = vi.fn(() => {
            expect(result.current.room.status).toBe('connecting');
            expect(source.getBaseline()?.history).toEqual([]);
        });
        const unsubscribe = source.subscribe(listener);

        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));

        expect(listener).toHaveBeenCalledOnce();
        expect(result.current.room.status).toBe('ready');
        expect(result.current.historySource).toBe(source);
        expect(MockEventSource.instances).toHaveLength(1);
        unsubscribe();
        unmount();
    });

    it('recovers a baseline through the same connection lifecycle and releases it on unmount', () => {
        const { result, unmount } = renderHook(useRoom);
        const source = result.current.historySource;
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));
        const closeOriginal = vi.spyOn(MockEventSource.latest(), 'close');

        act(() => source.requestBaseline());

        expect(closeOriginal).toHaveBeenCalledOnce();
        expect(source.getBaseline()).toBeUndefined();
        expect(result.current.room.connectionStatus).toBe('reconnecting');
        expect(MockEventSource.instances).toHaveLength(1);
        act(() => vi.advanceTimersByTime(1000));
        expect(MockEventSource.instances).toHaveLength(2);
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));
        expect(source.getBaseline()).toBeDefined();
        const closeReplacement = vi.spyOn(MockEventSource.latest(), 'close');
        unmount();

        expect(closeReplacement).toHaveBeenCalledOnce();
        source.requestBaseline();
        vi.advanceTimersByTime(2000);
        expect(MockEventSource.instances).toHaveLength(2);
    });

    it('keeps invalid messages out of both history and the room view', () => {
        const { result, unmount } = renderHook(useRoom);
        const listener = vi.fn();
        result.current.historySource.subscribe(listener);

        act(() =>
            MockEventSource.latest().emitMessage({ messageType: 'room.snapshot', payload: {} }),
        );

        expect(result.current.room.status).toBe('connecting');
        expect(result.current.room.contractError).toBeDefined();
        expect(result.current.historySource.getBaseline()).toBeUndefined();
        expect(listener).toHaveBeenCalledExactlyOnceWith({ kind: 'interrupted' });
        unmount();
    });

    it('retains the last known generation during unknown storage and replaces the history baseline when it changes', () => {
        const history = createUserHistoryFixtures();
        const { result, unmount } = renderHook(useRoom);
        const source = result.current.historySource;
        act(() =>
            MockEventSource.latest().emitMessage(
                createRoomSnapshotMessage({ userHistory: [history.gap] }),
            ),
        );
        const listener = vi.fn();
        source.subscribe(listener);

        act(() =>
            MockEventSource.latest().emitMessage({
                messageType: 'platform.updated',
                previousRevision: 0,
                revision: 1,
                sentAt: '2026-06-08T09:30:02Z',
                payload: {
                    storage: {
                        status: 'degraded',
                        changedAt: '2026-06-08T09:30:02Z',
                        reason: 'storage_write_failed',
                        historyGenerationId: null,
                        storedThroughSequence: null,
                    },
                },
            }),
        );
        expect(source.getBaseline()).toMatchObject({
            storage: { historyGenerationId: null },
            lastKnownHistoryGenerationId: 'generation-test',
            history: [history.gap],
        });

        act(() =>
            MockEventSource.latest().emitMessage({
                messageType: 'platform.updated',
                previousRevision: 1,
                revision: 2,
                sentAt: '2026-06-08T09:30:03Z',
                payload: {
                    storage: {
                        status: 'available',
                        changedAt: '2026-06-08T09:30:03Z',
                        historyGenerationId: 'replacement-generation',
                        storedThroughSequence: 0,
                    },
                },
            }),
        );
        expect(listener).toHaveBeenLastCalledWith(
            expect.objectContaining({
                kind: 'baseline',
                history: [],
                lastKnownHistoryGenerationId: 'replacement-generation',
            }),
        );
        expect(source.getBaseline()?.history).toEqual([]);
        unmount();
    });

    it('forwards every live telemetry addition synchronously even when React batches room renders', () => {
        const { telemetrySample } = createHistoryIdentityFixtures();
        const { result, unmount } = renderHook(useRoom);
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));
        const listener = vi.fn();
        result.current.historySource.subscribe(listener);
        const baseline = createRoomSnapshotMessage();

        if (baseline.messageType !== 'room.snapshot') {
            throw new Error('Expected a room baseline fixture');
        }

        const device = baseline.payload.devices[0];

        if (!device) {
            throw new Error('Expected the temperature fixture');
        }

        act(() => {
            for (const revision of [1, 2]) {
                MockEventSource.latest().emitMessage({
                    messageType: 'device.updated',
                    previousRevision: revision - 1,
                    revision,
                    sentAt: telemetrySample.occurredAt,
                    payload: device,
                    telemetrySample: { ...telemetrySample, storageSequence: revision },
                });
            }
        });
        expect(listener).toHaveBeenCalledTimes(2);
        expect(
            listener.mock.calls.map(([update]) => update.telemetrySample.storageSequence),
        ).toEqual([1, 2]);
        unmount();
    });
});
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
