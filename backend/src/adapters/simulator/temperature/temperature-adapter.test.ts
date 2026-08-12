import type { PlatformEvent } from '@smart-room/contracts/events';
import type {
    TemperatureAvailabilityListener,
    TemperatureAvailabilityMessage,
    TemperatureHealthListener,
    TemperatureHealthMessage,
    TemperatureReadingListener,
    TemperatureReadingMessage,
    TemperatureSensorSimulator,
} from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

import { createEventProcessor } from '../../../platform/event-processing/event-processor';
import { createRoomProjector } from '../../../platform/read-model/room-projection';

import { createSimulatorTemperatureAdapter } from './temperature-adapter';

describe('createSimulatorTemperatureAdapter', () => {
    it('lets the processor deduplicate replayed availability and health facts', () => {
        const sensor = createControllableSensor();
        const devices = [
            { deviceId: 'temp-platform', name: 'Temperature', role: 'temperature-sensor' },
        ] as const;
        const processor = createEventProcessor({
            devices: [...devices],
            roomProjector: createRoomProjector({
                devices: [...devices],
                initialUpdatedAt: '2026-06-08T09:29:59Z',
            }),
            clock: { now: () => '2026-06-08T09:30:00Z' },
        });
        const results: ReturnType<typeof processor.processEvent>[] = [];
        createSimulatorTemperatureAdapter({
            sensor: sensor.simulator,
            nativeSensorId: 'temp-native',
            platformDeviceId: 'temp-platform',
            emitEvent: (event) => results.push(processor.processEvent(event)),
        });
        const availabilityFact = availability('availability-1');
        const healthFact = health('health-1');
        sensor.emitAvailability(availabilityFact);
        sensor.emitAvailability(availabilityFact);
        sensor.emitHealth(healthFact);
        sensor.emitHealth(healthFact);

        expect(results.map((result) => result.status)).toEqual([
            'accepted',
            'ignored',
            'accepted',
            'ignored',
        ]);
        expect(
            results
                .filter((result) => result.status === 'ignored')
                .every((result) => result.reason === 'duplicate_event'),
        ).toBe(true);
    });

    it('translates readings, availability and health through one event sink', () => {
        const sensor = createControllableSensor();
        const events: PlatformEvent[] = [];
        createSimulatorTemperatureAdapter({
            sensor: sensor.simulator,
            nativeSensorId: 'temp-native',
            platformDeviceId: 'temp-platform',
            emitEvent: (event) => events.push(event),
        });

        sensor.emitReading(reading('reading-1'));
        sensor.emitAvailability(availability('availability-1'));
        sensor.emitHealth(health('health-1'));

        expect(events).toEqual([
            {
                eventId: 'simulator-adapter:temp-native:reading-1',
                eventType: 'telemetry.reading.recorded',
                occurredAt: '2026-06-08T09:30:00Z',
                source: 'simulator-adapter',
                deviceId: 'temp-platform',
                payload: { metric: 'temperature', value: 22.5, unit: 'celsius' },
            },
            {
                eventId: 'simulator-adapter:temp-native:availability-1',
                eventType: 'device.availability.changed',
                occurredAt: '2026-06-08T09:30:00Z',
                source: 'simulator-adapter',
                deviceId: 'temp-platform',
                payload: {
                    previousAvailability: 'unknown',
                    availability: 'online',
                    reason: 'simulator_reported',
                },
            },
            {
                eventId: 'simulator-adapter:temp-native:health-1',
                eventType: 'device.health.changed',
                occurredAt: '2026-06-08T09:30:00Z',
                source: 'simulator-adapter',
                deviceId: 'temp-platform',
                payload: { previousHealth: 'unknown', health: 'healthy', reason: 'recovered' },
            },
        ]);
    });

    it('preserves native message identity after later readings', () => {
        const sensor = createControllableSensor();
        const events: PlatformEvent[] = [];
        createSimulatorTemperatureAdapter({
            sensor: sensor.simulator,
            nativeSensorId: 'temp-native',
            platformDeviceId: 'temp-platform',
            emitEvent: (event) => events.push(event),
        });
        const first = reading('reading-1', 1);
        sensor.emitReading(first);
        sensor.emitReading(reading('reading-2', 2));
        sensor.emitReading(reading('reading-3', 3));
        sensor.emitReading(reading('reading-4', 4));
        sensor.emitReading(first);

        expect(events.map((event) => event.eventId)).toEqual([
            'simulator-adapter:temp-native:reading-1',
            'simulator-adapter:temp-native:reading-2',
            'simulator-adapter:temp-native:reading-3',
            'simulator-adapter:temp-native:reading-4',
            'simulator-adapter:temp-native:reading-1',
        ]);
    });

    it('keeps distinct native facts with identical contents distinct', () => {
        const sensor = createControllableSensor();
        const events: PlatformEvent[] = [];
        createSimulatorTemperatureAdapter({
            sensor: sensor.simulator,
            nativeSensorId: 'temp-native',
            platformDeviceId: 'temp-platform',
            emitEvent: (event) => events.push(event),
        });
        sensor.emitReading(reading('reading-1'));
        sensor.emitReading(reading('reading-2'));

        expect(events.map((event) => event.eventId)).toEqual([
            'simulator-adapter:temp-native:reading-1',
            'simulator-adapter:temp-native:reading-2',
        ]);
    });

    it('rejects foreign readings, availability and health before emission', () => {
        const sensor = createControllableSensor();
        const events: PlatformEvent[] = [];
        createSimulatorTemperatureAdapter({
            sensor: sensor.simulator,
            nativeSensorId: 'temp-native',
            platformDeviceId: 'temp-platform',
            emitEvent: (event) => events.push(event),
        });
        sensor.emitReading({ ...reading('reading-1'), sensorId: 'foreign' });
        sensor.emitAvailability({ ...availability('availability-1'), sensorId: 'foreign' });
        sensor.emitHealth({ ...health('health-1'), sensorId: 'foreign' });

        expect(events).toEqual([]);
    });

    it('unsubscribes every native stream after stop', () => {
        const sensor = createControllableSensor();
        const events: PlatformEvent[] = [];
        const adapter = createSimulatorTemperatureAdapter({
            sensor: sensor.simulator,
            nativeSensorId: 'temp-native',
            platformDeviceId: 'temp-platform',
            emitEvent: (event) => events.push(event),
        });
        adapter.stop();
        sensor.emitReading(reading('reading-1'));
        sensor.emitAvailability(availability('availability-1'));
        sensor.emitHealth(health('health-1'));

        expect(events).toEqual([]);
    });
});

function createControllableSensor(): {
    simulator: TemperatureSensorSimulator;
    emitReading(message: TemperatureReadingMessage): void;
    emitAvailability(message: TemperatureAvailabilityMessage): void;
    emitHealth(message: TemperatureHealthMessage): void;
} {
    const readings = new Set<TemperatureReadingListener>();
    const availabilities = new Set<TemperatureAvailabilityListener>();
    const healths = new Set<TemperatureHealthListener>();

    return {
        simulator: {
            onReading(listener) {
                readings.add(listener);

                return () => readings.delete(listener);
            },
            onAvailability(listener) {
                availabilities.add(listener);

                return () => availabilities.delete(listener);
            },
            onHealth(listener) {
                healths.add(listener);

                return () => healths.delete(listener);
            },
            tick() {
                return reading('unused');
            },
            reportAvailability() {
                return availability('unused');
            },
            reportHealth() {
                return health('unused');
            },
            reset() {},
        },
        emitReading(message) {
            for (const listener of readings) {
                listener(message);
            }
        },
        emitAvailability(message) {
            for (const listener of availabilities) {
                listener(message);
            }
        },
        emitHealth(message) {
            for (const listener of healths) {
                listener(message);
            }
        },
    };
}

function reading(messageId: string, sequence = 1): TemperatureReadingMessage {
    return {
        messageId,
        messageType: 'temperature.reading',
        sensorId: 'temp-native',
        sequence,
        value: 22.5,
        unit: 'celsius',
        recordedAt: '2026-06-08T09:30:00Z',
    };
}

function availability(messageId: string): TemperatureAvailabilityMessage {
    return {
        messageId,
        messageType: 'temperature.availability.changed',
        sensorId: 'temp-native',
        previousAvailability: 'unknown',
        availability: 'online',
        reportedAt: '2026-06-08T09:30:00Z',
    };
}

function health(messageId: string): TemperatureHealthMessage {
    return {
        messageId,
        messageType: 'temperature.health.changed',
        sensorId: 'temp-native',
        previousHealth: 'unknown',
        health: 'healthy',
        reason: 'recovered',
        reportedAt: '2026-06-08T09:30:00Z',
    };
}
