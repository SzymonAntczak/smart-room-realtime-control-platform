import type {
    PlatformEventEnvelope,
    TelemetryReadingRecordedEvent,
} from '@smart-room/contracts/events';
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

        expect(readPath.lastResult()).toMatchObject({
            status: 'accepted',
            state: {
                devices: [
                    {
                        availability: 'unknown',
                        health: 'unknown',
                        observationStatus: {
                            temperature: {
                                freshness: 'fresh',
                                lastObservedAt: '2026-06-08T09:30:00Z',
                            },
                        },
                        reportedState: { temperature: 22.5, temperatureUnit: 'celsius' },
                    },
                ],
            },
        });
    });

    it('updates the current projection for multiple simulator readings', () => {
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
    });

    it('keeps the latest reading visible when no further telemetry arrives', () => {
        const readPath = createTemperatureReadPath({
            eventIds: ['evt-temperature-1'],
            readingPattern: [0.5],
        });

        readPath.sensor.tick('2026-06-08T09:30:00Z');

        const staleProjection = readPath.getProjection('2026-06-08T09:30:02.501Z');
        expect(staleProjection.devices[0]?.observationStatus.temperature?.freshness).toBe('stale');
        expect(staleProjection.devices[0]?.availability).toBe('unknown');
        expect(staleProjection.devices[0]?.reportedState).toEqual({
            temperature: 22.5,
            temperatureUnit: 'celsius',
        });
    });

    it('recovers freshness after a fresh scenario reading', () => {
        const readPath = createTemperatureReadPath({
            eventIds: ['evt-temperature-1', 'evt-temperature-2'],
            readingPattern: [0.5, 0.8],
        });

        readPath.sensor.tick('2026-06-08T09:30:00Z');
        expect(
            readPath.getProjection('2026-06-08T09:30:10.001Z').devices[0]?.observationStatus
                .temperature?.freshness,
        ).toBe('stale');

        readPath.sensor.tick('2026-06-08T09:30:11Z');

        const recoveredProjection = readPath.getProjection('2026-06-08T09:30:11Z');

        expect(recoveredProjection.devices[0]).toEqual(
            expect.objectContaining({
                availability: 'unknown',
                observationStatus: {
                    temperature: { freshness: 'fresh', lastObservedAt: '2026-06-08T09:30:11Z' },
                },
                reportedState: {
                    temperature: 22.8,
                    temperatureUnit: 'celsius',
                },
            }),
        );
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
    let processingNow = '2026-06-08T09:29:59Z';
    const processor = createEventProcessor({
        devices,
        roomProjector: projector,
        clock: { now: () => processingNow },
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
            processingNow = event.occurredAt;
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
