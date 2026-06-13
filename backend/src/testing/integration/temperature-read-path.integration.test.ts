import { describe, expect, it } from 'vitest';
import { createTemperatureSensorSimulator } from '../../../../simulator/src';
import type { TelemetryReadingRecordedEvent } from '../../../../shared/src/events';
import { createSimulatorTemperatureAdapter } from '../../adapters/simulator/temperature/temperature-adapter';
import {
    createEventProcessor,
    type DeviceDefinition,
    type EventProcessingResult,
} from '../../platform/event-processing/event-processor';
import { createRoomProjector } from '../../platform/read-model/room-projection';

describe('temperature read path integration', () => {
    it('projects a simulator temperature reading into room state', () => {
        const readPath = createTemperatureReadPath({
            eventIds: ['evt-temperature-1'],
            readingPattern: [0.5],
        });

        readPath.sensor.tick('2026-06-08T09:30:00Z');

        expect(readPath.lastResult()).toEqual({
            status: 'accepted',
            state: {
                updatedAt: '2026-06-08T09:30:00Z',
                devices: [
                    {
                        deviceId: 'temp-desk',
                        name: 'Desk Temperature',
                        role: 'temperature-sensor',
                        health: 'online',
                        reportedState: {
                            temperature: 22.5,
                            temperatureUnit: 'celsius',
                        },
                        commandAvailability: {
                            policy: 'block',
                            reason: 'read_only_device',
                        },
                        lastSeenAt: '2026-06-08T09:30:00Z',
                    },
                ],
                activeCommands: [],
                recentEvents: [
                    {
                        eventId: 'evt-temperature-1',
                        eventType: 'telemetry.reading.recorded',
                        occurredAt: '2026-06-08T09:30:00Z',
                        source: 'simulator-adapter',
                        deviceId: 'temp-desk',
                        commandId: undefined,
                        summary: 'Temperature reading recorded',
                    },
                ],
            },
        });
    });

    it('updates projection and event history for multiple simulator readings', () => {
        const readPath = createTemperatureReadPath({
            eventIds: ['evt-temperature-1', 'evt-temperature-2'],
            readingPattern: [0.5, 0.7],
        });

        readPath.sensor.tick('2026-06-08T09:30:00Z');
        readPath.sensor.tick('2026-06-08T09:30:01Z');

        const result = readPath.lastResult();

        expect(result.status).toBe('accepted');
        expect(result.state.updatedAt).toBe('2026-06-08T09:30:01Z');
        expect(result.state.devices[0]?.reportedState).toEqual({
            temperature: 22.7,
            temperatureUnit: 'celsius',
        });
        expect(result.state.recentEvents.map((event) => event.eventId)).toEqual([
            'evt-temperature-2',
            'evt-temperature-1',
        ]);
    });

    it('ignores duplicate event ids across the integrated pipeline', () => {
        const readPath = createTemperatureReadPath({
            eventIds: ['evt-temperature-1', 'evt-temperature-1'],
            readingPattern: [0.5, 0.7],
        });

        readPath.sensor.tick('2026-06-08T09:30:00Z');
        readPath.sensor.tick('2026-06-08T09:30:01Z');

        const result = readPath.lastResult();

        expect(result).toMatchObject({
            status: 'ignored',
            reason: 'duplicate_event',
        });
        expect(result.state.devices[0]?.reportedState).toEqual({
            temperature: 22.5,
            temperatureUnit: 'celsius',
        });
        expect(result.state.recentEvents).toHaveLength(1);
    });
});

function createTemperatureReadPath({
    eventIds,
    readingPattern,
}: {
    eventIds: string[];
    readingPattern: readonly [number, ...number[]];
}) {
    const devices: DeviceDefinition[] = [
        {
            deviceId: 'temp-desk',
            name: 'Desk Temperature',
            role: 'temperature-sensor',
        },
    ];
    const sensor = createTemperatureSensorSimulator({
        sensorId: 'temp-desk-native',
        baseTemperature: 22,
        readingPattern,
    });
    const processor = createEventProcessor({
        devices,
        roomProjector: createRoomProjector({
            initialUpdatedAt: '2026-06-08T09:29:59Z',
            devices,
        }),
    });
    const results: EventProcessingResult[] = [];
    const pendingEventIds = [...eventIds];

    createSimulatorTemperatureAdapter({
        sensor,
        deviceId: 'temp-desk',
        generateEventId() {
            const eventId = pendingEventIds.shift();

            if (!eventId) {
                throw new Error('No deterministic event id configured for this reading.');
            }

            return eventId;
        },
        emitEvent(event: TelemetryReadingRecordedEvent) {
            results.push(processor.processEvent(event));
        },
    });

    return {
        sensor,
        lastResult() {
            const result = results.at(-1);

            if (!result) {
                throw new Error('No event processing result was emitted.');
            }

            return result;
        },
    };
}
