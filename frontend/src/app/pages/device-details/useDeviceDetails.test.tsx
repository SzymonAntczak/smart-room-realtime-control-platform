import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockEventSource } from '../../../test/room/mock-event-source';
import { RoomProvider } from '../../shared/room-realtime';

import { useDeviceDetails } from './useDeviceDetails';

describe('useDeviceDetails', () => {
    beforeEach(() => {
        MockEventSource.instances.length = 0;
        vi.stubGlobal('EventSource', MockEventSource);
    });

    afterEach(() => vi.unstubAllGlobals());

    it('waits for a valid snapshot before resolving whether the device exists', () => {
        const { result } = renderHook(() => useDeviceDetails('temp-desk'), {
            wrapper: RoomProvider,
        });

        expect(result.current).toEqual({ status: 'connecting', connectionStatus: 'connecting' });

        act(() => MockEventSource.latest().emitMessage(createSnapshot([])));

        expect(result.current).toEqual({
            status: 'ready',
            deviceId: 'temp-desk',
            device: undefined,
            connectionStatus: 'connected',
        });
    });

    it('keeps the last valid device while the realtime source reconnects', () => {
        const { result } = renderHook(() => useDeviceDetails('temp-desk'), {
            wrapper: RoomProvider,
        });
        act(() => MockEventSource.latest().emitMessage(createSnapshot([temperatureDevice()])));

        const retainedDevice =
            result.current.status === 'ready' ? result.current.device : undefined;
        act(() => MockEventSource.latest().emitError());

        expect(result.current).toMatchObject({
            status: 'ready',
            deviceId: 'temp-desk',
            device: retainedDevice,
            connectionStatus: 'reconnecting',
        });
    });

    it('closes its source and cancels a pending reconnect when the provider unmounts', () => {
        vi.useFakeTimers();
        const { unmount } = renderHook(() => useDeviceDetails('temp-desk'), {
            wrapper: RoomProvider,
        });
        const source = MockEventSource.latest();
        act(() => source.emitError());

        unmount();
        vi.advanceTimersByTime(1000);

        expect(MockEventSource.instances).toHaveLength(1);
        vi.useRealTimers();
    });
});

function createSnapshot(devices: unknown[]) {
    return {
        messageType: 'room.snapshot',
        revision: 0,
        sentAt: '2026-10-15T10:00:00Z',
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-10-15T10:00:00Z',
            devices,
            activeCommands: [],
            recentCommands: [],
            userHistory: [],
            platform: {
                storage: {
                    status: 'available',
                    changedAt: '2026-10-15T10:00:00Z',
                    historyGenerationId: 'generation-test',
                    storedThroughSequence: 0,
                },
            },
        },
    };
}

function temperatureDevice() {
    return {
        deviceId: 'temp-desk',
        name: 'Desk temperature',
        role: 'temperature-sensor',
        availability: 'online',
        availabilityChangedAt: '2026-10-15T10:00:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-10-15T10:00:00Z',
        healthDurability: 'durable',
        reportedState: { temperature: 22.4, temperatureUnit: 'celsius' },
        commandAvailability: { policy: 'block', reason: 'read_only_device' },
        observationStatus: {
            temperature: {
                freshness: 'fresh',
                lastObservedAt: '2026-10-15T10:00:00Z',
                durability: 'durable',
            },
        },
    };
}
