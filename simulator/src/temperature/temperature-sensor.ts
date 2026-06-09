type NonEmptyReadingPattern = readonly [number, ...number[]];

export interface TemperatureReadingMessage {
    messageType: 'temperature.reading';
    sensorId: string;
    sequence: number;
    value: number;
    unit: 'celsius';
    recordedAt: string;
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
                listener(message);
            }

            return message;
        },
    };
}
