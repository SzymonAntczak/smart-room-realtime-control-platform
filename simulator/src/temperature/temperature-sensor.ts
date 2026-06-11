type NonEmptyReadingPattern = readonly [number, ...number[]];

export interface TemperatureReadingMessage {
    readonly messageType: 'temperature.reading';
    readonly sensorId: string;
    readonly sequence: number;
    readonly value: number;
    readonly unit: 'celsius';
    readonly recordedAt: string;
}

export interface TemperatureSensorConfig {
    sensorId: string;
    baseTemperature: number;
    readingPattern: NonEmptyReadingPattern;
}

export type TemperatureReadingListener = (message: TemperatureReadingMessage) => void;

export interface TemperatureSensorSimulator {
    onReading(listener: TemperatureReadingListener): () => void;
    tick(recordedAt: string): TemperatureReadingMessage;
}

export function createTemperatureSensorSimulator(
    config: TemperatureSensorConfig,
): TemperatureSensorSimulator {
    assertValidConfig(config);

    const listeners = new Set<TemperatureReadingListener>();
    let nextSequence = 0;

    return {
        onReading(listener) {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        tick(recordedAt) {
            assertValidIsoTimestamp(recordedAt, 'Temperature reading recordedAt');

            const sequence = nextSequence;
            nextSequence += 1;

            const message: TemperatureReadingMessage = {
                messageType: 'temperature.reading',
                sensorId: config.sensorId,
                sequence,
                value:
                    config.baseTemperature +
                    config.readingPattern[sequence % config.readingPattern.length],
                unit: 'celsius',
                recordedAt,
            };

            for (const listener of listeners) {
                listener({ ...message });
            }

            return message;
        },
    };
}

function assertValidConfig(config: TemperatureSensorConfig): void {
    if (config.sensorId.trim().length === 0) {
        throw new TypeError('Temperature sensorId must be a non-empty string.');
    }

    if (!Number.isFinite(config.baseTemperature)) {
        throw new TypeError('Temperature baseTemperature must be a finite number.');
    }

    for (const readingOffset of config.readingPattern) {
        if (!Number.isFinite(readingOffset)) {
            throw new TypeError('Temperature readingPattern values must be finite numbers.');
        }
    }
}

function assertValidIsoTimestamp(timestamp: string, label: string): void {
    const parsedTime = Date.parse(timestamp);

    if (!Number.isFinite(parsedTime)) {
        throw new TypeError(`${label} must be a valid timestamp string.`);
    }
}
