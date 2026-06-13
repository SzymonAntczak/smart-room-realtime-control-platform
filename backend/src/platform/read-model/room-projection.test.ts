import { describe, expect, it } from 'vitest';
import type { TelemetryReadingRecordedEvent } from '../../../../shared/src/events';
import { createRoomProjector } from './room-projection';

describe('createRoomProjector', () => {
    it('starts with an empty projection at the configured timestamp', () => {
        const projector = createTemperatureProjector();

        expect(projector.getProjection()).toEqual({
            updatedAt: '2026-06-08T09:29:59Z',
            devices: [],
            activeCommands: [],
            recentEvents: [],
        });
    });

    it('projects accepted temperature telemetry into device state and event history', () => {
        const projector = createTemperatureProjector();

        const projection = projector.applyTelemetryReadingRecorded(createTemperatureEvent());

        expect(projection).toEqual({
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
        });
    });

    it('rejects projection updates for unknown devices', () => {
        const projector = createTemperatureProjector();

        expect(() =>
            projector.applyTelemetryReadingRecorded(
                createTemperatureEvent({
                    deviceId: 'unknown-temp',
                }),
            ),
        ).toThrow('Cannot project telemetry for unknown device: unknown-temp');
        expect(projector.getProjection().devices).toEqual([]);
    });

    it('keeps the newest events first in recent history', () => {
        const projector = createTemperatureProjector();

        projector.applyTelemetryReadingRecorded(
            createTemperatureEvent({
                eventId: 'evt-temperature-1',
                occurredAt: '2026-06-08T09:30:00Z',
            }),
        );
        projector.applyTelemetryReadingRecorded(
            createTemperatureEvent({
                eventId: 'evt-temperature-2',
                occurredAt: '2026-06-08T09:30:01Z',
            }),
        );

        expect(projector.getProjection().recentEvents.map((event) => event.eventId)).toEqual([
            'evt-temperature-2',
            'evt-temperature-1',
        ]);
    });

    it('limits recent event history when configured', () => {
        const projector = createTemperatureProjector({
            recentEventLimit: 2,
        });

        projector.applyTelemetryReadingRecorded(
            createTemperatureEvent({
                eventId: 'evt-temperature-1',
                occurredAt: '2026-06-08T09:30:00Z',
            }),
        );
        projector.applyTelemetryReadingRecorded(
            createTemperatureEvent({
                eventId: 'evt-temperature-2',
                occurredAt: '2026-06-08T09:30:01Z',
            }),
        );
        projector.applyTelemetryReadingRecorded(
            createTemperatureEvent({
                eventId: 'evt-temperature-3',
                occurredAt: '2026-06-08T09:30:02Z',
            }),
        );

        expect(projector.getProjection().recentEvents.map((event) => event.eventId)).toEqual([
            'evt-temperature-3',
            'evt-temperature-2',
        ]);
    });
});

function createTemperatureProjector({ recentEventLimit }: { recentEventLimit?: number } = {}) {
    return createRoomProjector({
        initialUpdatedAt: '2026-06-08T09:29:59Z',
        recentEventLimit,
        devices: [
            {
                deviceId: 'temp-desk',
                name: 'Desk Temperature',
                role: 'temperature-sensor',
            },
        ],
    });
}

function createTemperatureEvent(
    overrides: Partial<TelemetryReadingRecordedEvent> = {},
): TelemetryReadingRecordedEvent {
    return {
        eventId: 'evt-temperature-1',
        eventType: 'telemetry.reading.recorded',
        version: 1,
        occurredAt: '2026-06-08T09:30:00Z',
        source: 'simulator-adapter',
        deviceId: 'temp-desk',
        payload: {
            metric: 'temperature',
            value: 22.5,
            unit: 'celsius',
        },
        ...overrides,
    };
}
