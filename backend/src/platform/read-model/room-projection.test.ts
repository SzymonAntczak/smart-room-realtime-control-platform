import type { TelemetryReadingRecordedEvent } from '@smart-room/contracts/events';
import { describe, expect, it } from 'vitest';

import { createRoomProjector } from './room-projection';

describe('createRoomProjector', () => {
    it('starts with an empty projection at the configured timestamp', () => {
        const projector = createTemperatureProjector();

        expect(projector.getProjection()).toEqual({
            updatedAt: '2026-06-08T09:29:59Z',
            devices: [],
            activeCommands: [],
            recentCommands: [],
        });
    });

    it('projects accepted temperature telemetry into current device state', () => {
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
            recentCommands: [],
        });
    });

    it('derives stale temperature health when telemetry exceeds the freshness window', () => {
        const projector = createTemperatureProjector();

        projector.applyTelemetryReadingRecorded(createTemperatureEvent());

        const projection = projector.getProjection({
            evaluatedAt: '2026-06-08T09:30:02.501Z',
        });

        expect(projection.devices[0]?.health).toBe('stale');
        expect(projection.updatedAt).toBe('2026-06-08T09:30:00Z');
    });

    it('keeps temperature online at the exact stale threshold', () => {
        const projector = createTemperatureProjector();

        projector.applyTelemetryReadingRecorded(createTemperatureEvent());

        expect(
            projector.getProjection({
                evaluatedAt: '2026-06-08T09:30:02.500Z',
            }).devices[0]?.health,
        ).toBe('online');
    });

    it('derives offline temperature health when telemetry exceeds the offline threshold', () => {
        const projector = createTemperatureProjector();

        projector.applyTelemetryReadingRecorded(createTemperatureEvent());

        const projection = projector.getProjection({
            evaluatedAt: '2026-06-08T09:30:10.001Z',
        });

        expect(projection.devices[0]?.health).toBe('offline');
        expect(projection.updatedAt).toBe('2026-06-08T09:30:00Z');
    });

    it('keeps temperature stale at the exact offline threshold measured from last seen time', () => {
        const projector = createTemperatureProjector();

        projector.applyTelemetryReadingRecorded(createTemperatureEvent());

        expect(
            projector.getProjection({
                evaluatedAt: '2026-06-08T09:30:10.000Z',
            }).devices[0]?.health,
        ).toBe('stale');
    });

    it('derives online temperature health again after a fresh reading', () => {
        const projector = createTemperatureProjector();

        projector.applyTelemetryReadingRecorded(createTemperatureEvent());
        expect(
            projector.getProjection({
                evaluatedAt: '2026-06-08T09:30:10.001Z',
            }).devices[0]?.health,
        ).toBe('offline');

        projector.applyTelemetryReadingRecorded(
            createTemperatureEvent({
                eventId: 'evt-temperature-2',
                occurredAt: '2026-06-08T09:30:11Z',
                payload: {
                    metric: 'temperature',
                    value: 22.8,
                    unit: 'celsius',
                },
            }),
        );

        const projection = projector.getProjection({
            evaluatedAt: '2026-06-08T09:30:11Z',
        });

        expect(projection.devices[0]).toEqual(
            expect.objectContaining({
                health: 'online',
                lastSeenAt: '2026-06-08T09:30:11Z',
                reportedState: {
                    temperature: 22.8,
                    temperatureUnit: 'celsius',
                },
            }),
        );
    });

    it('does not let out-of-order temperature telemetry regress current state', () => {
        const projector = createTemperatureProjector();

        projector.applyTelemetryReadingRecorded(
            createTemperatureEvent({
                eventId: 'evt-temperature-1',
                occurredAt: '2026-06-08T09:30:11Z',
                payload: {
                    metric: 'temperature',
                    value: 22.8,
                    unit: 'celsius',
                },
            }),
        );

        const projection = projector.applyTelemetryReadingRecorded(
            createTemperatureEvent({
                eventId: 'evt-temperature-late',
                occurredAt: '2026-06-08T09:30:05Z',
                payload: {
                    metric: 'temperature',
                    value: 18.2,
                    unit: 'celsius',
                },
            }),
        );

        expect(projection.updatedAt).toBe('2026-06-08T09:30:11Z');
        expect(projection.devices[0]).toEqual(
            expect.objectContaining({
                health: 'online',
                lastSeenAt: '2026-06-08T09:30:11Z',
                reportedState: {
                    temperature: 22.8,
                    temperatureUnit: 'celsius',
                },
            }),
        );
    });

    it('does not recover offline health from an out-of-order report evaluated later', () => {
        const projector = createTemperatureProjector();

        projector.applyTelemetryReadingRecorded(createTemperatureEvent());
        const projection = projector.applyTelemetryReadingRecorded(
            createTemperatureEvent({
                eventId: 'evt-temperature-late',
                occurredAt: '2026-06-08T09:29:59Z',
            }),
            { evaluatedAt: '2026-06-08T09:30:10.001Z' },
        );

        expect(projection.devices[0]).toEqual(
            expect.objectContaining({
                health: 'offline',
                lastSeenAt: '2026-06-08T09:30:00Z',
            }),
        );
    });

    it('does not let equal-timestamp temperature telemetry regress current state', () => {
        const projector = createTemperatureProjector();

        projector.applyTelemetryReadingRecorded(createTemperatureEvent());
        const projection = projector.applyTelemetryReadingRecorded(
            createTemperatureEvent({
                eventId: 'evt-temperature-same-time',
                occurredAt: '2026-06-08T09:30:00Z',
                payload: {
                    metric: 'temperature',
                    value: 18.2,
                    unit: 'celsius',
                },
            }),
        );

        expect(projection.updatedAt).toBe('2026-06-08T09:30:00Z');
        expect(projection.devices[0]).toEqual(
            expect.objectContaining({
                lastSeenAt: '2026-06-08T09:30:00Z',
                reportedState: {
                    temperature: 22.5,
                    temperatureUnit: 'celsius',
                },
            }),
        );
    });

    it('rejects invalid freshness evaluation timestamps', () => {
        const projector = createTemperatureProjector();

        projector.applyTelemetryReadingRecorded(createTemperatureEvent());

        expect(() =>
            projector.getProjection({
                evaluatedAt: 'not-a-date',
            }),
        ).toThrow('Invalid timestamp for projection.evaluatedAt: not-a-date');
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
});

function createTemperatureProjector() {
    return createRoomProjector({
        initialUpdatedAt: '2026-06-08T09:29:59Z',
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
