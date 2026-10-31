import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { MockEventSource } from '../../../test/room/mock-event-source';
import {
    createLedDevice,
    createRoomSnapshotMessage,
    createTemperatureDevice,
} from '../../../test/room/room-realtime-fixtures';
import { RoomProvider } from '../../shared/room-realtime';

import { useRoom } from './useRoom';
it('maps shared room devices to Dashboard projections', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    const { result, unmount } = renderHook(useRoom, { wrapper: RoomProvider });
    act(() =>
        MockEventSource.latest().emitMessage(
            createRoomSnapshotMessage({ devices: [createLedDevice(), createTemperatureDevice()] }),
        ),
    );
    expect(result.current.room).toMatchObject({
        status: 'ready',
        snapshot: { devices: [{ role: 'led-output' }, { role: 'temperature-sensor' }] },
    });
    unmount();
    vi.unstubAllGlobals();
});
