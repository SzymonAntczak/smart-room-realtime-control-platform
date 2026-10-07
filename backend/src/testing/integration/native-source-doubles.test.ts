import { describe, expect, it, vi } from 'vitest';

import {
    createLedDouble,
    createNativeSourceRegistry,
    createTemperatureDouble,
} from './native-source-doubles';

describe('native-source test doubles', () => {
    it('emits native readings to subscribed listeners only and permits explicit replay', () => {
        const source = createTemperatureDouble({
            sensorId: 'native',
            baseTemperature: 20,
            readingPattern: [0],
        });
        const listener = vi.fn();
        const unsubscribe = source.scenario.onReading(listener);
        const reading = source.read(21, '2026-09-26T10:00:00Z');
        expect(listener).toHaveBeenLastCalledWith({
            ...reading,
            messageType: 'temperature.reading',
            sensorId: 'native',
            value: 21,
        });
        source.scenario.replayLastReading();
        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener.mock.calls[1]).toEqual(listener.mock.calls[0]);
        unsubscribe();
        source.read(22, '2026-09-26T10:00:01Z');
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('accepts a native command without fabricating confirmation and emits only an explicit outcome', () => {
        const source = createLedDouble({
            deviceId: 'native-led',
            initialPower: 'off',
            scenario: 'confirm_immediately',
            clock: { now: () => '2026-09-26T10:00:00Z' },
            scheduler: { setTimeout: () => 0, clearTimeout() {} },
        });
        const listener = vi.fn();
        source.scenario.onStateReport(listener);
        const command = {
            messageType: 'led.command.set_power',
            commandId: 'command',
            deviceId: 'native-led',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        } as const;
        expect(source.scenario.receive(command)).toEqual({
            status: 'accepted',
            acceptedAt: '2026-09-26T10:00:00Z',
        });
        expect(source.received).toEqual([command]);
        expect(listener).not.toHaveBeenCalled();
        expect(source.scenario.getObservedPower()).toBe('off');
        source.reportState('on', '2026-09-26T10:00:01Z');
        expect(listener).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                messageType: 'led.state.reported',
                reportedState: { power: 'on' },
            }),
        );
        source.scenario.stop();
        source.reportState('off', '2026-09-26T10:00:02Z');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('clears every previously created source subscription and starts a fresh registry', () => {
        const registry = createNativeSourceRegistry();
        const config = { sensorId: 'native', baseTemperature: 20, readingPattern: [0] as const };
        const previous = registry.temperatureFactory(config);
        const next = registry.temperatureFactory(config);
        const listener = vi.fn();
        previous.onReading(listener);
        next.onReading(listener);
        registry.reset();
        previous.tick('2026-09-26T10:00:00Z');
        next.tick('2026-09-26T10:00:00Z');
        expect(listener).not.toHaveBeenCalled();
        expect(() => registry.temperature('native')).toThrow('Missing native source');
        const fresh = registry.temperatureFactory(config);
        fresh.onReading(listener);
        fresh.tick('2026-09-26T10:00:00Z');
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
