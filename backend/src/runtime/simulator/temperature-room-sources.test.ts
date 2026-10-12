import type { PlatformEvent } from '@smart-room/contracts/events';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { describe, expect, it, vi } from 'vitest';

import { createTemperatureRoomSources } from './temperature-room-sources';

describe('temperature room sources', () => {
    it('connects configured sensors and LED through platform events and scopes scenarios', () => {
        const events: PlatformEvent[] = [];
        let now = '2026-09-10T10:00:00.000Z';
        const sources = createTemperatureRoomSources({
            intervalMs: 1_000,
            clock: { now: () => now },
            generateNativeMessageId: (() => {
                let nextId = 0;

                return () => `native-${++nextId}`;
            })(),
            ledScenario: 'confirm_immediately',
            ledScenarioScheduler: {
                setTimeout() {
                    return 1;
                },
                clearTimeout() {},
            },
            emitEvent(event) {
                events.push(event);
            },
            getRoomSnapshot: () => emptySnapshot,
            getActiveStorage: () => undefined,
            onReceiptFailure: vi.fn(),
        });

        expect(sources.devices.map((device) => device.deviceId)).toEqual([
            'temp-desk',
            'temp-window',
            'led-main',
        ]);

        sources.startCommandSources();
        sources.startObservationSources();

        expect(events.map((event) => event.deviceId)).toContain('led-main');
        expect(events.map((event) => event.deviceId)).toContain('temp-desk');
        expect(events.map((event) => event.deviceId)).toContain('temp-window');
        expect(sources.getDeviceScenarios('missing-device')).toBeUndefined();
        expect(sources.getDeviceScenarios('temp-desk')?.scenarios.length).toBeGreaterThan(0);

        now = '2026-09-10T10:00:01.000Z';
        expect(sources.runDeviceScenario('temp-desk', 'emit_next_reading')).toEqual({
            action: 'emit_next_reading',
            status: 'completed',
        });
        expect(events.at(-1)).toMatchObject({
            eventType: 'telemetry.reading.recorded',
            deviceId: 'temp-desk',
        });

        sources.stop();
    });
});

const emptySnapshot = {
    roomName: 'Test room',
    updatedAt: '2026-09-10T10:00:00.000Z',
    devices: [],
    activeCommands: [],
    recentCommands: [],
    recentEvents: [],
    platform: {
        storage: {
            status: 'degraded',
            changedAt: '2026-09-10T10:00:00.000Z',
            reason: 'storage_not_configured',
            historyGenerationId: null,
            storedThroughSequence: null,
        },
    },
} as unknown as RoomSnapshotProjection;
