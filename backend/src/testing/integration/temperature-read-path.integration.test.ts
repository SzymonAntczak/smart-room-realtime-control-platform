import type { PlatformEventEnvelope, TelemetryReadingRecordedEvent } from '@smart-room/contracts';
import { createTemperatureSensorScenario } from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

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

    it('keeps event history visible when telemetry stops and health becomes stale or offline', () => {
        const readPath = createTemperatureReadPath({
            eventIds: ['evt-temperature-1'],
            readingPattern: [0.5],
        });

        readPath.sensor.tick('2026-06-08T09:30:00Z');
        readPath.sensor.pauseTelemetry('2026-06-08T09:30:02.501Z');

        const staleProjection = readPath.getProjection('2026-06-08T09:30:02.501Z');
        const offlineProjection = readPath.getProjection('2026-06-08T09:30:10.001Z');

        expect(staleProjection.devices[0]?.health).toBe('stale');
        expect(offlineProjection.devices[0]?.health).toBe('offline');
        expect(offlineProjection.devices[0]?.reportedState).toEqual({
            temperature: 22.5,
            temperatureUnit: 'celsius',
        });
        expect(offlineProjection.recentEvents.map((event) => event.eventId)).toEqual([
            'evt-temperature-1',
        ]);
    });

    it('recovers from stale or offline health after a fresh scenario reading', () => {
        const readPath = createTemperatureReadPath({
            eventIds: ['evt-temperature-1', 'evt-temperature-2'],
            readingPattern: [0.5, 0.8],
        });

        readPath.sensor.tick('2026-06-08T09:30:00Z');
        expect(readPath.getProjection('2026-06-08T09:30:10.001Z').devices[0]?.health).toBe(
            'offline',
        );

        readPath.sensor.tick('2026-06-08T09:30:11Z');

        const recoveredProjection = readPath.getProjection('2026-06-08T09:30:11Z');

        expect(recoveredProjection.devices[0]).toEqual(
            expect.objectContaining({
                health: 'online',
                lastSeenAt: '2026-06-08T09:30:11Z',
                reportedState: {
                    temperature: 22.8,
                    temperatureUnit: 'celsius',
                },
            }),
        );
        expect(recoveredProjection.recentEvents.map((event) => event.eventId)).toEqual([
            'evt-temperature-2',
            'evt-temperature-1',
        ]);
    });

    it('rejects replayed native readings as duplicate platform events', () => {
        const readPath = createTemperatureReadPath({
            eventIds: ['evt-temperature-1', 'evt-temperature-replay'],
            readingPattern: [0.5],
        });

        readPath.sensor.tick('2026-06-08T09:30:00Z');
        readPath.sensor.replayLastReading();

        const result = readPath.lastResult();

        expect(result).toMatchObject({
            status: 'ignored',
            reason: 'duplicate_event',
        });
        expect(result.state.devices[0]?.reportedState).toEqual({
            temperature: 22.5,
            temperatureUnit: 'celsius',
        });
        expect(result.state.recentEvents.map((event) => event.eventId)).toEqual([
            'evt-temperature-1',
        ]);
    });

    it('ignores invalid telemetry without changing the last accepted state', () => {
        const readPath = createTemperatureReadPath({
            eventIds: ['evt-temperature-1'],
            readingPattern: [0.5],
        });

        readPath.sensor.tick('2026-06-08T09:30:00Z');

        const result = readPath.processEvent(
            createInvalidTemperatureEvent({
                eventId: 'evt-temperature-invalid',
                occurredAt: '2026-06-08T09:30:01Z',
            }),
        );

        expect(result).toMatchObject({
            status: 'ignored',
            reason: 'invalid_payload',
        });
        expect(result.state.devices[0]?.reportedState).toEqual({
            temperature: 22.5,
            temperatureUnit: 'celsius',
        });
        expect(result.state.recentEvents.map((event) => event.eventId)).toEqual([
            'evt-temperature-1',
        ]);
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
    const sensor = createTemperatureSensorScenario({
        sensorId: 'temp-desk-native',
        baseTemperature: 22,
        readingPattern,
    });
    const projector = createRoomProjector({
        initialUpdatedAt: '2026-06-08T09:29:59Z',
        devices,
    });
    const processor = createEventProcessor({
        devices,
        roomProjector: projector,
    });
    const results: EventProcessingResult[] = [];
    const pendingEventIds = [...eventIds];

    createSimulatorTemperatureAdapter({
        sensor,
        nativeSensorId: 'temp-desk-native',
        platformDeviceId: 'temp-desk',
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
        getProjection(evaluatedAt: string) {
            return projector.getProjection({
                evaluatedAt,
            });
        },
        processEvent(event: unknown) {
            const result = processor.processEvent(event);
            results.push(result);

            return result;
        },
        lastResult() {
            const result = results.at(-1);

            if (!result) {
                throw new Error('No event processing result was emitted.');
            }

            return result;
        },
    };
}

function createInvalidTemperatureEvent(
    overrides: Partial<PlatformEventEnvelope> = {},
): PlatformEventEnvelope {
    return {
        eventId: 'evt-temperature-invalid',
        eventType: 'telemetry.reading.recorded',
        version: 1,
        occurredAt: '2026-06-08T09:30:01Z',
        source: 'simulator-adapter',
        deviceId: 'temp-desk',
        payload: {
            metric: 'temperature',
            value: Number.NaN,
            unit: 'celsius',
        },
        ...overrides,
    };
}
