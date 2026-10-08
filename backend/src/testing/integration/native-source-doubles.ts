import type {
    LedAvailabilityReport,
    LedCommandRejection,
    LedHealthReport,
    LedScenario,
    LedScenarioConfig,
    LedSetPowerCommand,
    LedStateReport,
    TemperatureAvailabilityMessage,
    TemperatureHealthMessage,
    TemperatureReadingMessage,
    TemperatureSensorConfig,
    TemperatureSensorScenario,
} from '@smart-room/simulator';

function channel<Message>() {
    const listeners = new Set<(message: Message) => void>();

    return {
        subscribe(listener: (message: Message) => void) {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        emit(message: Message) {
            listeners.forEach((listener) => listener(message));
        },
        clear() {
            listeners.clear();
        },
    };
}

export function createTemperatureDouble(config: TemperatureSensorConfig) {
    const readings = channel<TemperatureReadingMessage>();
    const availability = channel<TemperatureAvailabilityMessage>();
    const health = channel<TemperatureHealthMessage>();
    let sequence = 0;
    let identity = 0;
    let value = config.baseTemperature;
    let last: TemperatureReadingMessage | undefined;
    let observedAvailability: TemperatureAvailabilityMessage['previousAvailability'] = 'unknown';
    let observedHealth: TemperatureHealthMessage['previousHealth'] = 'unknown';
    const messageId = () => config.generateMessageId?.() ?? `${config.sensorId}-${++identity}`;
    const scenario: TemperatureSensorScenario = {
        onReading: readings.subscribe,
        onAvailability: availability.subscribe,
        onHealth: health.subscribe,
        tick(recordedAt) {
            const reading: TemperatureReadingMessage = {
                messageId: messageId(),
                messageType: 'temperature.reading',
                sensorId: config.sensorId,
                sequence: sequence++,
                value,
                unit: 'celsius',
                recordedAt,
            };
            last = reading;
            readings.emit(reading);

            return reading;
        },
        reportAvailability(next, reportedAt) {
            const report: TemperatureAvailabilityMessage = {
                messageId: messageId(),
                messageType: 'temperature.availability.changed',
                sensorId: config.sensorId,
                previousAvailability: observedAvailability,
                availability: next,
                reportedAt,
            };
            observedAvailability = next;
            availability.emit(report);

            return report;
        },
        reportHealth(next, reason, reportedAt) {
            const report: TemperatureHealthMessage = {
                messageId: messageId(),
                messageType: 'temperature.health.changed',
                sensorId: config.sensorId,
                previousHealth: observedHealth,
                health: next,
                reason,
                reportedAt,
            };
            observedHealth = next;
            health.emit(report);

            return report;
        },
        disconnect(reportedAt) {
            scenario.reportAvailability('offline', reportedAt);
        },
        reconnect(reportedAt) {
            scenario.reportAvailability('online', reportedAt);
        },
        isOffline() {
            return observedAvailability === 'offline';
        },
        replayLastReading() {
            if (!last) {
                throw new Error('No native reading to replay');
            }

            readings.emit(last);

            return last;
        },
        emitInvalidReading(recordedAt) {
            const prior = value;
            value = Number.NaN;
            const reading = scenario.tick(recordedAt);
            value = prior;

            return reading;
        },
        emitFutureDatedReading: (recordedAt) => scenario.tick(recordedAt),
        reset() {
            sequence = 0;
            last = undefined;
            observedAvailability = 'unknown';
        },
    };

    return {
        scenario,
        emitAvailability: availability.emit,
        emitReading(reading: TemperatureReadingMessage) {
            last = reading;
            readings.emit(reading);
        },
        read(nextValue: number, recordedAt: string) {
            value = nextValue;

            return scenario.tick(recordedAt);
        },
        clear() {
            readings.clear();
            availability.clear();
            health.clear();
        },
    };
}

export function createLedDouble(config: LedScenarioConfig) {
    const reports = channel<LedStateReport>();
    const rejections = channel<LedCommandRejection>();
    const availability = channel<LedAvailabilityReport>();
    const health = channel<LedHealthReport>();
    const commands = channel<LedSetPowerCommand>();
    const received: LedSetPowerCommand[] = [];
    let power = config.initialPower;
    let sequence = 0;
    let identity = 0;
    let observedAvailability: LedAvailabilityReport['previousAvailability'] = 'unknown';
    let observedHealth: LedHealthReport['previousHealth'] = 'unknown';
    const messageId = () => config.generateMessageId?.() ?? `${config.deviceId}-${++identity}`;

    const reportState = (next: 'on' | 'off', reportedAt: string) => {
        const report: LedStateReport = {
            messageId: messageId(),
            messageType: 'led.state.reported',
            deviceId: config.deviceId,
            sequence: sequence++,
            reportedState: { power: next },
            reportedAt,
        };
        power = next;
        reports.emit(report);

        return report;
    };

    const scenario: LedScenario = {
        onCommand: commands.subscribe,
        onStateReport: reports.subscribe,
        onCommandRejection: rejections.subscribe,
        onAvailability: availability.subscribe,
        onHealth: health.subscribe,
        receive(command, context) {
            received.push(command);
            commands.emit(command);

            // Acceptance is a transport result, not a device-state confirmation.
            return { status: 'accepted', acceptedAt: context?.attemptedAt ?? config.clock.now() };
        },
        reportAvailability(next, reportedAt) {
            const report: LedAvailabilityReport = {
                messageId: messageId(),
                messageType: 'led.availability.changed',
                deviceId: config.deviceId,
                previousAvailability: observedAvailability,
                availability: next,
                reportedAt,
            };
            observedAvailability = next;
            availability.emit(report);

            return report;
        },
        reportHealth(next, reason, reportedAt) {
            const report: LedHealthReport = {
                messageId: messageId(),
                messageType: 'led.health.changed',
                deviceId: config.deviceId,
                previousHealth: observedHealth,
                health: next,
                reason,
                reportedAt,
            };
            observedHealth = next;
            health.emit(report);

            return report;
        },
        reportCurrentState: (reportedAt) => reportState(power, reportedAt),
        getObservedPower: () => power,
        setNextCommandScenario() {},
        restoreDurablePlans() {},
        resumeAfterStorageRecovery() {},
        stop() {
            reports.clear();
            rejections.clear();
            availability.clear();
            health.clear();
            commands.clear();
        },
    };

    return {
        scenario,
        received,
        reportState,
        reject(command: LedSetPowerCommand, rejectedAt: string) {
            const rejection: LedCommandRejection = {
                messageId: messageId(),
                messageType: 'led.command.rejected',
                commandId: command.commandId,
                deviceId: config.deviceId,
                reason: 'command_rejected',
                rejectedAt,
            };
            rejections.emit(rejection);

            return rejection;
        },
    };
}

export function createNativeSourceRegistry() {
    const temperatures = new Map<string, ReturnType<typeof createTemperatureDouble>>();
    const createdTemperatures: Array<ReturnType<typeof createTemperatureDouble>> = [];
    const createdLeds: Array<ReturnType<typeof createLedDouble>> = [];
    let led: ReturnType<typeof createLedDouble> | undefined;

    return {
        temperatureFactory(config: TemperatureSensorConfig) {
            const source = createTemperatureDouble(config);
            temperatures.set(config.sensorId, source);
            createdTemperatures.push(source);

            return source.scenario;
        },
        ledFactory(config: LedScenarioConfig) {
            led = createLedDouble(config);
            createdLeds.push(led);

            return led.scenario;
        },
        temperature(id = 'temp-desk-native') {
            const source = temperatures.get(id);

            if (!source) {
                throw new Error(`Missing native source ${id}`);
            }

            return source;
        },
        led() {
            if (!led) {
                throw new Error('Missing native LED source');
            }

            return led;
        },
        reset() {
            createdTemperatures.splice(0).forEach((source) => source.clear());
            temperatures.clear();
            createdLeds.splice(0).forEach((source) => source.scenario.stop());
            led = undefined;
        },
    };
}
