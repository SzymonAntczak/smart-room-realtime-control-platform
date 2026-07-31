import {
    createTemperatureSensorSimulator,
    type TemperatureReadingListener,
    type TemperatureReadingMessage,
    type TemperatureSensorConfig,
    type TemperatureSensorSimulator,
} from './temperature-sensor';

export interface TemperatureTelemetryPause {
    readonly scenarioEvent: 'telemetry.pause';
    readonly observedAt: string;
}

export interface TemperatureTelemetryResume {
    readonly scenarioEvent: 'telemetry.resume';
    readonly observedAt: string;
}

export interface TemperatureSensorScenario extends TemperatureSensorSimulator {
    pauseTelemetry(observedAt: string): TemperatureTelemetryPause;
    resumeTelemetry(observedAt: string): TemperatureTelemetryResume;
    replayLastReading(): TemperatureReadingMessage;
    emitInvalidReading(recordedAt: string): TemperatureReadingMessage;
    reset(): void;
}

export function createTemperatureSensorScenario(
    config: TemperatureSensorConfig,
): TemperatureSensorScenario {
    let sensor = createTemperatureSensorSimulator(config);
    const listeners = new Set<TemperatureReadingListener>();
    let lastReading: TemperatureReadingMessage | undefined;

    return {
        onReading(listener) {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        tick(recordedAt) {
            const reading = sensor.tick(recordedAt);
            lastReading = reading;
            emitReading(reading);

            return reading;
        },
        pauseTelemetry(observedAt) {
            assertValidIsoTimestamp(observedAt, 'Temperature telemetry pause observedAt');

            return {
                scenarioEvent: 'telemetry.pause',
                observedAt,
            };
        },
        resumeTelemetry(observedAt) {
            assertValidIsoTimestamp(observedAt, 'Temperature telemetry resume observedAt');

            return {
                scenarioEvent: 'telemetry.resume',
                observedAt,
            };
        },
        replayLastReading() {
            if (!lastReading) {
                throw new Error('Cannot replay temperature reading before one has been recorded.');
            }

            emitReading(lastReading);

            return { ...lastReading };
        },
        emitInvalidReading(recordedAt) {
            const reading = sensor.tick(recordedAt);
            const invalidReading = {
                ...reading,
                value: Number.NaN,
            };

            emitReading(invalidReading);

            return invalidReading;
        },
        reset() {
            sensor = createTemperatureSensorSimulator(config);
            lastReading = undefined;
        },
    };

    function emitReading(reading: TemperatureReadingMessage): void {
        for (const listener of listeners) {
            listener({ ...reading });
        }
    }
}

function assertValidIsoTimestamp(timestamp: string, label: string): void {
    const parsedTime = Date.parse(timestamp);

    if (!Number.isFinite(parsedTime)) {
        throw new TypeError(`${label} must be a valid timestamp string.`);
    }
}
