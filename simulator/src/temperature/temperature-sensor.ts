type NonEmptyReadingPattern = readonly [number, ...number[]];

export interface TemperatureReadingMessage {
    readonly messageType: 'temperature.reading';
    readonly sensorId: string;
    readonly sequence: number;
    readonly value: number;
    readonly unit: 'celsius';
    readonly recordedAt: string;
}
export interface TemperatureAvailabilityMessage {
    readonly messageType: 'temperature.availability.changed';
    readonly sensorId: string;
    readonly availability: 'online' | 'offline';
    readonly previousAvailability: 'online' | 'offline' | 'unknown';
    readonly reportedAt: string;
}
export interface TemperatureHealthMessage {
    readonly messageType: 'temperature.health.changed';
    readonly sensorId: string;
    readonly health: 'healthy' | 'degraded';
    readonly previousHealth: 'healthy' | 'degraded' | 'unknown';
    readonly reason: string;
    readonly reportedAt: string;
}

export interface TemperatureSensorConfig {
    sensorId: string;
    baseTemperature: number;
    readingPattern: NonEmptyReadingPattern;
}

export type TemperatureReadingListener = (message: TemperatureReadingMessage) => void;
export type TemperatureAvailabilityListener = (message: TemperatureAvailabilityMessage) => void;
export type TemperatureHealthListener = (message: TemperatureHealthMessage) => void;

export interface TemperatureSensorSimulator {
    onReading(listener: TemperatureReadingListener): () => void;
    onAvailability?(listener: TemperatureAvailabilityListener): () => void;
    onHealth?(listener: TemperatureHealthListener): () => void;
    tick(recordedAt: string): TemperatureReadingMessage;
    reportAvailability?(
        availability: 'online' | 'offline',
        reportedAt: string,
    ): TemperatureAvailabilityMessage;
    reportHealth?(
        health: 'healthy' | 'degraded',
        reason: string,
        reportedAt: string,
    ): TemperatureHealthMessage;
}

export function createTemperatureSensorSimulator(
    config: TemperatureSensorConfig,
): TemperatureSensorSimulator {
    assertValidConfig(config);

    const listeners = new Set<TemperatureReadingListener>();
    const availabilityListeners = new Set<TemperatureAvailabilityListener>();
    const healthListeners = new Set<TemperatureHealthListener>();
    let nextSequence = 0;
    let observedAvailability: TemperatureAvailabilityMessage['previousAvailability'] = 'unknown';
    let observedHealth: TemperatureHealthMessage['previousHealth'] = 'unknown';

    return {
        onReading(listener) {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        onAvailability(listener) {
            availabilityListeners.add(listener);

            return () => availabilityListeners.delete(listener);
        },
        onHealth(listener) {
            healthListeners.add(listener);

            return () => healthListeners.delete(listener);
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
        reportAvailability(availability, reportedAt) {
            assertValidIsoTimestamp(reportedAt, 'Temperature availability reportedAt');
            const message: TemperatureAvailabilityMessage = {
                messageType: 'temperature.availability.changed',
                sensorId: config.sensorId,
                availability,
                previousAvailability: observedAvailability,
                reportedAt,
            };
            observedAvailability = availability;

            for (const listener of availabilityListeners) {
                listener({ ...message });
            }

            return message;
        },
        reportHealth(health, reason, reportedAt) {
            assertNonEmpty(reason, 'Temperature health reason');
            assertValidIsoTimestamp(reportedAt, 'Temperature health reportedAt');
            const message: TemperatureHealthMessage = {
                messageType: 'temperature.health.changed',
                sensorId: config.sensorId,
                health,
                previousHealth: observedHealth,
                reason,
                reportedAt,
            };
            observedHealth = health;

            for (const listener of healthListeners) {
                listener({ ...message });
            }

            return message;
        },
    };
}

function assertNonEmpty(value: string, label: string): void {
    if (value.trim().length === 0) {
        throw new TypeError(`${label} must be a non-empty string.`);
    }
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
