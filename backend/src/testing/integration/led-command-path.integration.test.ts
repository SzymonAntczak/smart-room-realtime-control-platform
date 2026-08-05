import { createLedScenario } from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

import { createSimulatorLedAdapter } from '../../adapters/simulator/led/led-adapter';
import { createEventProcessor } from '../../platform/event-processing/event-processor';
import { createRoomProjector } from '../../platform/read-model/room-projection';

describe('LED command path', () => {
    it('routes a simulator state report through the adapter to the event processor', () => {
        const simulator = createLedScenario({
            deviceId: 'led-main-native',
            initialPower: 'off',
            scenario: 'confirm_immediately',
            clock: { now: () => '2026-08-05T10:00:00Z' },
            scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
        });
        const processor = createEventProcessor({
            devices: [{ deviceId: 'led-main', name: 'Main LED', role: 'led-output' }],
            roomProjector: createRoomProjector({
                devices: [{ deviceId: 'led-main', name: 'Main LED', role: 'led-output' }],
                initialUpdatedAt: '2026-08-05T10:00:00Z',
            }),
            clock: { now: () => '2026-08-05T10:00:00Z' },
        });
        const results: ReturnType<typeof processor.processEvent>[] = [];
        const adapter = createSimulatorLedAdapter({
            led: simulator,
            nativeLedId: 'led-main-native',
            platformDeviceId: 'led-main',
            generateEventId: () => 'evt-led-report-1',
            emitEvent(event) {
                results.push(processor.processEvent(event));
            },
        });

        adapter.dispatch({
            commandId: 'cmd-led-1',
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });

        expect(simulator.getObservedPower()).toBe('on');
        expect(results).toEqual([expect.objectContaining({ status: 'accepted' })]);
        expect(results[0]?.state.devices).toEqual([
            expect.objectContaining({
                deviceId: 'led-main',
                reportedState: { power: 'on' },
                commandAvailability: { policy: 'allow' },
            }),
        ]);
    });
});
