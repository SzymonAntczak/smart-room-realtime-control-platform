import type {
    ActiveCommandProjection,
    CommandDispatchedEvent,
    CommandFailedEvent,
    CommandRequestedEvent,
    CommandTimedOutEvent,
    DeviceHealth,
    DeviceProjection,
    DeviceRole,
    DeviceState,
    DeviceStateReportedEvent,
    TelemetryReadingRecordedEvent,
    TelemetryReadingRecordedPayload,
    TerminalCommandProjection,
} from '@smart-room/contracts';

export interface DeviceDefinition {
    deviceId: string;
    name: string;
    role: DeviceRole;
}

export interface DeviceFreshnessThresholds {
    staleAfterMs: number;
    offlineAfterMs: number;
}

export type FreshnessThresholdsByRole = Partial<Record<DeviceRole, DeviceFreshnessThresholds>>;

export interface RoomProjectionConfig {
    devices: DeviceDefinition[];
    initialUpdatedAt: string;
    freshnessThresholdsByRole?: FreshnessThresholdsByRole;
}

export interface ProjectionEvaluationOptions {
    evaluatedAt?: string;
}

export interface RoomProjection {
    updatedAt: string;
    devices: DeviceProjection[];
    activeCommands: ActiveCommandProjection[];
    recentCommands: TerminalCommandProjection[];
}

export interface RoomProjector {
    applyDeviceStateReported(
        event: DeviceStateReportedEvent,
        options?: ProjectionEvaluationOptions,
    ): RoomProjection;
    applyTelemetryReadingRecorded(
        event: TelemetryReadingRecordedEvent,
        options?: ProjectionEvaluationOptions,
    ): RoomProjection;
    applyCommandRequested(event: CommandRequestedEvent): RoomProjection;
    applyCommandDispatched(event: CommandDispatchedEvent): RoomProjection;
    applyCommandFailed(event: CommandFailedEvent): RoomProjection;
    applyCommandTimedOut(event: CommandTimedOutEvent): RoomProjection;
    getProjection(options?: ProjectionEvaluationOptions): RoomProjection;
}

export function createRoomProjector({
    devices,
    initialUpdatedAt,
    freshnessThresholdsByRole = defaultFreshnessThresholdsByRole,
}: RoomProjectionConfig): RoomProjector {
    const deviceDefinitions = new Map(devices.map((device) => [device.deviceId, device]));
    const deviceProjections = new Map<string, DeviceProjection>();
    const activeCommandsByDeviceId = new Map<string, ActiveCommandProjection>();
    const recentCommands: TerminalCommandProjection[] = [];
    let updatedAt = initialUpdatedAt;

    return {
        applyDeviceStateReported(event, options = {}) {
            const device = deviceDefinitions.get(event.deviceId);
            if (!device) {
                throw new Error(
                    `Cannot project device state for unknown device: ${event.deviceId}`,
                );
            }

            const currentDevice = deviceProjections.get(device.deviceId);
            if (
                currentDevice?.lastSeenAt &&
                parseTimestamp(event.occurredAt, 'event.occurredAt') <=
                    parseTimestamp(currentDevice.lastSeenAt, 'device.lastSeenAt')
            ) {
                return buildProjection({ evaluatedAt: options.evaluatedAt ?? event.occurredAt });
            }

            updatedAt = event.occurredAt;
            deviceProjections.set(device.deviceId, {
                deviceId: device.deviceId,
                name: device.name,
                role: device.role,
                health: 'online',
                reportedState: event.payload.reportedState,
                commandAvailability: { policy: 'allow' },
                lastSeenAt: event.occurredAt,
            });

            const activeCommand = activeCommandsByDeviceId.get(device.deviceId);
            if (
                activeCommand?.status === 'pending' &&
                isOnOrAfter(event.occurredAt, activeCommand.dispatchedAt) &&
                matchesSetPowerCommand(activeCommand, event.payload.reportedState)
            ) {
                moveToRecent({
                    ...activeCommand,
                    status: 'confirmed',
                    confirmedAt: event.occurredAt,
                });
            }

            return buildProjection({ evaluatedAt: options.evaluatedAt ?? event.occurredAt });
        },
        applyTelemetryReadingRecorded(event, options = {}) {
            const device = deviceDefinitions.get(event.deviceId);

            if (!device) {
                throw new Error(`Cannot project telemetry for unknown device: ${event.deviceId}`);
            }

            const currentDevice = deviceProjections.get(device.deviceId);

            if (
                currentDevice?.lastSeenAt &&
                parseTimestamp(event.occurredAt, 'event.occurredAt') <=
                    parseTimestamp(currentDevice.lastSeenAt, 'device.lastSeenAt')
            ) {
                return buildProjection({
                    evaluatedAt: options.evaluatedAt ?? event.occurredAt,
                });
            }

            updatedAt = event.occurredAt;
            deviceProjections.set(device.deviceId, {
                deviceId: device.deviceId,
                name: device.name,
                role: device.role,
                health: 'online',
                reportedState: toTemperatureReportedState(event.payload),
                commandAvailability: {
                    policy: 'block',
                    reason: 'read_only_device',
                },
                lastSeenAt: event.occurredAt,
            });

            return buildProjection({
                evaluatedAt: options.evaluatedAt ?? event.occurredAt,
            });
        },
        applyCommandRequested(event) {
            assertProjectableLedCommandDevice(event.deviceId);
            assertUnusedCommandId(event.commandId);
            const activeCommand = activeCommandsByDeviceId.get(event.deviceId);

            if (activeCommand) {
                throw new Error(`Device ${event.deviceId} already has an active command.`);
            }
            activeCommandsByDeviceId.set(event.deviceId, {
                commandId: event.commandId,
                deviceId: event.deviceId,
                commandType: event.payload.commandType,
                requestedState: event.payload.requestedState,
                requestedAt: event.occurredAt,
                status: 'accepted',
            });
            updatedAt = event.occurredAt;
            return buildProjection({ evaluatedAt: event.occurredAt });
        },
        applyCommandDispatched(event) {
            const activeCommand = requireActiveCommand(event.deviceId, event.commandId);
            if (activeCommand.status !== 'accepted') {
                throw new Error(
                    `Cannot dispatch command ${event.commandId} from ${activeCommand.status}.`,
                );
            }
            assertChronological(event.occurredAt, activeCommand.requestedAt, 'dispatch');
            activeCommandsByDeviceId.set(event.deviceId, {
                ...activeCommand,
                status: 'pending',
                dispatchedAt: event.occurredAt,
            });
            updatedAt = event.occurredAt;
            return buildProjection({ evaluatedAt: event.occurredAt });
        },
        applyCommandFailed(event) {
            const activeCommand = activeCommandsByDeviceId.get(event.deviceId);
            if (!activeCommand || activeCommand.commandId !== event.commandId) {
                const rejectedCommand = toRejectedCommandFailure(event);
                assertProjectableLedCommandDevice(event.deviceId);
                assertUnusedCommandId(event.commandId);
                updatedAt = event.occurredAt;
                addRecentCommand(rejectedCommand);
                return buildProjection({ evaluatedAt: event.occurredAt });
            }
            assertChronological(event.occurredAt, activeCommand.requestedAt, 'failure');
            if (activeCommand.status === 'pending') {
                assertChronological(event.occurredAt, activeCommand.dispatchedAt, 'failure');
            }
            updatedAt = event.occurredAt;
            moveToRecent({
                ...activeCommand,
                status: 'failed',
                failedAt: event.occurredAt,
                reason: event.payload.reason,
                message: event.payload.message,
            });
            return buildProjection({ evaluatedAt: event.occurredAt });
        },
        applyCommandTimedOut(event) {
            const activeCommand = requireActiveCommand(event.deviceId, event.commandId);
            if (activeCommand.status !== 'pending') {
                throw new Error(
                    `Cannot time out command ${event.commandId} from ${activeCommand.status}.`,
                );
            }
            if (event.payload.timeoutMs !== ledSetPowerTimeoutMs) {
                throw new Error(`LED set.power timeout must be ${ledSetPowerTimeoutMs} ms.`);
            }
            assertChronological(event.occurredAt, activeCommand.dispatchedAt, 'timeout');
            if (
                Date.parse(event.occurredAt) - Date.parse(activeCommand.dispatchedAt) <
                ledSetPowerTimeoutMs
            ) {
                throw new Error(
                    `Command timeout must occur at least ${ledSetPowerTimeoutMs} ms after dispatch.`,
                );
            }
            updatedAt = event.occurredAt;
            moveToRecent({
                ...activeCommand,
                status: 'timed_out',
                timedOutAt: event.occurredAt,
                reason: event.payload.reason,
            });
            return buildProjection({ evaluatedAt: event.occurredAt });
        },
        getProjection(options = {}) {
            return buildProjection({
                evaluatedAt: options.evaluatedAt ?? updatedAt,
            });
        },
    };

    function buildProjection({
        evaluatedAt,
    }: Required<ProjectionEvaluationOptions>): RoomProjection {
        return {
            updatedAt,
            devices: [...deviceProjections.values()].map((device) => {
                const activeCommand = activeCommandsByDeviceId.get(device.deviceId);
                return {
                    ...applyFreshnessHealth(device, evaluatedAt),
                    ...(activeCommand ? { activeCommandId: activeCommand.commandId } : {}),
                };
            }),
            activeCommands: [...activeCommandsByDeviceId.values()],
            recentCommands: [...recentCommands],
        };
    }

    function assertProjectableLedCommandDevice(deviceId: string): void {
        const device = deviceDefinitions.get(deviceId);
        if (!device || device.role !== 'led-output' || !deviceProjections.has(deviceId)) {
            throw new Error(`Cannot project a set.power command for device ${deviceId}.`);
        }
    }

    function requireActiveCommand(deviceId: string, commandId: string): ActiveCommandProjection {
        const command = activeCommandsByDeviceId.get(deviceId);
        if (!command || command.commandId !== commandId) {
            throw new Error(`No active command ${commandId} exists for device ${deviceId}.`);
        }
        return command;
    }

    function assertUnusedCommandId(commandId: string): void {
        if (
            [...activeCommandsByDeviceId.values()].some(
                (command) => command.commandId === commandId,
            ) ||
            recentCommands.some((command) => command.commandId === commandId)
        ) {
            throw new Error(`Command ${commandId} is already projected.`);
        }
    }

    function assertChronological(
        occurredAt: string,
        previousTimestamp: string,
        transition: string,
    ): void {
        if (!isOnOrAfter(occurredAt, previousTimestamp)) {
            throw new Error(`Command ${transition} cannot precede its previous lifecycle state.`);
        }
    }

    function moveToRecent(command: TerminalCommandProjection): void {
        activeCommandsByDeviceId.delete(command.deviceId);
        addRecentCommand(command);
    }

    function addRecentCommand(command: TerminalCommandProjection): void {
        recentCommands.unshift(command);
        recentCommands.sort((left, right) => terminalTimestamp(right) - terminalTimestamp(left));
        recentCommands.length = Math.min(recentCommands.length, 20);
    }

    function applyFreshnessHealth(device: DeviceProjection, evaluatedAt: string): DeviceProjection {
        if (!device.lastSeenAt) {
            return { ...device };
        }

        const thresholds = freshnessThresholdsByRole[device.role];

        if (!thresholds) {
            return { ...device };
        }

        return {
            ...device,
            health: deriveFreshnessHealth({
                lastSeenAt: device.lastSeenAt,
                evaluatedAt,
                thresholds,
            }),
        };
    }
}

const defaultFreshnessThresholdsByRole: FreshnessThresholdsByRole = {
    'temperature-sensor': {
        staleAfterMs: 2500,
        offlineAfterMs: 10000,
    },
};

export const ledSetPowerTimeoutMs = 5_000;

function deriveFreshnessHealth({
    lastSeenAt,
    evaluatedAt,
    thresholds,
}: {
    lastSeenAt: string;
    evaluatedAt: string;
    thresholds: DeviceFreshnessThresholds;
}): DeviceHealth {
    const ageMs = Math.max(
        0,
        parseTimestamp(evaluatedAt, 'projection.evaluatedAt') -
            parseTimestamp(lastSeenAt, 'device.lastSeenAt'),
    );

    if (ageMs > thresholds.offlineAfterMs) {
        return 'offline';
    }

    if (ageMs > thresholds.staleAfterMs) {
        return 'stale';
    }

    return 'online';
}

function parseTimestamp(timestamp: string, fieldName: string): number {
    const parsed = Date.parse(timestamp);

    if (Number.isNaN(parsed)) {
        throw new Error(`Invalid timestamp for ${fieldName}: ${timestamp}`);
    }

    return parsed;
}

function toTemperatureReportedState(payload: TelemetryReadingRecordedPayload): DeviceState {
    return {
        temperature: payload.value,
        temperatureUnit: payload.unit,
    };
}

function matchesSetPowerCommand(
    command: ActiveCommandProjection,
    reportedState: DeviceState,
): boolean {
    return (
        command.commandType === 'set.power' && reportedState.power === command.requestedState.power
    );
}

function terminalTimestamp(command: TerminalCommandProjection): number {
    switch (command.status) {
        case 'confirmed':
            return parseTimestamp(command.confirmedAt, 'command.confirmedAt');
        case 'failed':
            return parseTimestamp(command.failedAt, 'command.failedAt');
        case 'timed_out':
            return parseTimestamp(command.timedOutAt, 'command.timedOutAt');
    }
}

function isOnOrAfter(timestamp: string, referenceTimestamp: string): boolean {
    return (
        parseTimestamp(timestamp, 'timestamp') >=
        parseTimestamp(referenceTimestamp, 'reference timestamp')
    );
}

function toRejectedCommandFailure(event: CommandFailedEvent): TerminalCommandProjection {
    const { commandType, requestedState, requestedAt } = event.payload;

    if (commandType !== 'set.power' || !requestedState || !requestedAt) {
        throw new Error(
            `No active command ${event.commandId} exists for device ${event.deviceId}.`,
        );
    }
    if (!isOnOrAfter(event.occurredAt, requestedAt)) {
        throw new Error('Command failure cannot precede the rejected request.');
    }

    return {
        commandId: event.commandId,
        deviceId: event.deviceId,
        commandType,
        requestedState,
        requestedAt,
        status: 'failed',
        failedAt: event.occurredAt,
        reason: event.payload.reason,
        message: event.payload.message,
    };
}
