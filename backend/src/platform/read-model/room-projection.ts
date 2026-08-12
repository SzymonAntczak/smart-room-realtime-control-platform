import type {
    ActiveCommandProjection,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import type { DeviceRole, DeviceState } from '@smart-room/contracts/devices';
import type {
    CommandDispatchedEvent,
    CommandFailedEvent,
    CommandRequestedEvent,
    CommandTimedOutEvent,
    DeviceAvailabilityChangedEvent,
    DeviceHealthChangedEvent,
    DeviceStateReportedEvent,
    TelemetryReadingRecordedEvent,
    TelemetryReadingRecordedPayload,
} from '@smart-room/contracts/events';
import type { DeviceProjection } from '@smart-room/contracts/projections';

import { commandAvailabilityFor } from './command-availability';
import {
    type FreshnessThresholdsByRole,
    withFreshness,
} from './observation-freshness';

export interface DeviceDefinition {
    deviceId: string;
    name: string;
    role: DeviceRole;
}

export type { DeviceFreshnessThresholds, FreshnessThresholdsByRole } from './observation-freshness';
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
    applyDeviceAvailabilityChanged(event: DeviceAvailabilityChangedEvent): RoomProjection;
    applyDeviceHealthChanged(event: DeviceHealthChangedEvent): RoomProjection;
    applyCommandRequested(event: CommandRequestedEvent): RoomProjection;
    applyCommandDispatched(event: CommandDispatchedEvent): RoomProjection;
    applyCommandFailed(event: CommandFailedEvent): RoomProjection;
    applyCommandTimedOut(event: CommandTimedOutEvent): RoomProjection;
    getProjection(options?: ProjectionEvaluationOptions): RoomProjection;
}

export class InvalidLifecycleTransitionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidLifecycleTransitionError';
    }
}

export function createRoomProjector({
    devices,
    initialUpdatedAt,
    freshnessThresholdsByRole = defaultFreshnessThresholdsByRole,
}: RoomProjectionConfig): RoomProjector {
    const definitions = new Map(devices.map((device) => [device.deviceId, device]));
    const projections = new Map<string, DeviceProjection>(
        devices.map((device) => [device.deviceId, bootstrap(device, initialUpdatedAt)]),
    );
    const activeByDeviceId = new Map<string, ActiveCommandProjection>();
    const recent: TerminalCommandProjection[] = [];
    let updatedAt = initialUpdatedAt;

    return {
        applyDeviceStateReported(event, options = {}) {
            const current = requireDevice(event.deviceId);
            const observation = current.observationStatus.power;

            if (
                observation?.lastObservedAt &&
                !isLater(event.occurredAt, observation.lastObservedAt)
            ) {
                return build(options.evaluatedAt ?? event.occurredAt);
            }

            updatedAt = event.occurredAt;
            projections.set(
                event.deviceId,
                withObservation(current, 'power', event.occurredAt, event.payload.reportedState),
            );
            const active = activeByDeviceId.get(event.deviceId);

            if (
                active?.status === 'pending' &&
                isOnOrAfter(event.occurredAt, active.dispatchedAt) &&
                matchesSetPowerCommand(active, event.payload.reportedState)
            ) {
                moveToRecent({ ...active, status: 'confirmed', confirmedAt: event.occurredAt });
            }

            return build(options.evaluatedAt ?? event.occurredAt);
        },
        applyTelemetryReadingRecorded(event, options = {}) {
            const current = requireDevice(event.deviceId);
            const observation = current.observationStatus.temperature;

            if (
                observation?.lastObservedAt &&
                !isLater(event.occurredAt, observation.lastObservedAt)
            ) {
                return build(options.evaluatedAt ?? event.occurredAt);
            }

            updatedAt = event.occurredAt;
            projections.set(
                event.deviceId,
                withObservation(
                    current,
                    'temperature',
                    event.occurredAt,
                    toTemperatureReportedState(event.payload),
                ),
            );

            return build(options.evaluatedAt ?? event.occurredAt);
        },
        applyDeviceAvailabilityChanged(event) {
            const current = requireDevice(event.deviceId);

            if (!isLater(event.occurredAt, current.availabilityChangedAt)) {
                return build(event.occurredAt);
            }

            updatedAt = event.occurredAt;
            const next = {
                ...current,
                availability: event.payload.availability,
                availabilityChangedAt: event.occurredAt,
                commandAvailability: commandAvailabilityFor(
                    current.role,
                    event.payload.availability,
                    current.health,
                    current.healthReason,
                ),
                ...(event.payload.availability === 'offline'
                    ? { availabilityReason: event.payload.reason }
                    : {}),
            };

            if (event.payload.availability !== 'offline') {
                delete next.availabilityReason;
            }

            projections.set(event.deviceId, next);

            return build(event.occurredAt);
        },
        applyDeviceHealthChanged(event) {
            const current = requireDevice(event.deviceId);

            if (!isLater(event.occurredAt, current.healthChangedAt)) {
                return build(event.occurredAt);
            }

            updatedAt = event.occurredAt;
            const next = {
                ...current,
                health: event.payload.health,
                healthChangedAt: event.occurredAt,
                commandAvailability: commandAvailabilityFor(
                    current.role,
                    current.availability,
                    event.payload.health,
                    event.payload.health === 'degraded' ? event.payload.reason : undefined,
                ),
                ...(event.payload.health === 'degraded'
                    ? { healthReason: event.payload.reason }
                    : {}),
            };

            if (event.payload.health !== 'degraded') {
                delete next.healthReason;
            }

            projections.set(event.deviceId, next);

            return build(event.occurredAt);
        },
        applyCommandRequested(event) {
            const device = requireDevice(event.deviceId);

            if (device.role !== 'led-output' || !device.observationStatus.power?.lastObservedAt) {
                throw new InvalidLifecycleTransitionError(
                    `Cannot project a set.power command for device ${event.deviceId}.`,
                );
            }

            if (activeByDeviceId.has(event.deviceId)) {
                throw new InvalidLifecycleTransitionError(
                    `Device ${event.deviceId} already has an active command.`,
                );
            }

            assertUnusedCommandId(event.commandId);
            activeByDeviceId.set(event.deviceId, {
                commandId: event.commandId,
                deviceId: event.deviceId,
                commandType: event.payload.commandType,
                requestedState: event.payload.requestedState,
                requestedAt: event.occurredAt,
                status: 'accepted',
            });
            updatedAt = event.occurredAt;

            return build(event.occurredAt);
        },
        applyCommandDispatched(event) {
            const active = requireActive(event.deviceId, event.commandId);

            if (active.status !== 'accepted') {
                throw new InvalidLifecycleTransitionError(`Cannot dispatch command ${event.commandId}.`);
            }

            assertChronological(event.occurredAt, active.requestedAt, 'dispatch');
            activeByDeviceId.set(event.deviceId, {
                ...active,
                status: 'pending',
                dispatchedAt: event.occurredAt,
            });
            updatedAt = event.occurredAt;

            return build(event.occurredAt);
        },
        applyCommandFailed(event) {
            const active = activeByDeviceId.get(event.deviceId);

            if (!active || active.commandId !== event.commandId) {
                const rejected = toRejectedCommandFailure(event);
                requireDevice(event.deviceId);
                assertUnusedCommandId(event.commandId);
                addRecent(rejected);
                updatedAt = event.occurredAt;

                return build(event.occurredAt);
            }

            assertChronological(event.occurredAt, active.requestedAt, 'failure');

            if (active.status === 'pending') {
                assertChronological(event.occurredAt, active.dispatchedAt, 'failure');
            }

            updatedAt = event.occurredAt;
            moveToRecent({
                ...active,
                status: 'failed',
                failedAt: event.occurredAt,
                reason: event.payload.reason,
                message: event.payload.message,
            });

            return build(event.occurredAt);
        },
        applyCommandTimedOut(event) {
            const active = requireActive(event.deviceId, event.commandId);

            if (active.status !== 'pending') {
                throw new InvalidLifecycleTransitionError(`Cannot time out command ${event.commandId}.`);
            }

            if (event.payload.timeoutMs !== ledSetPowerTimeoutMs) {
                throw new InvalidLifecycleTransitionError(
                    `LED set.power timeout must be ${ledSetPowerTimeoutMs} ms.`,
                );
            }

            assertChronological(event.occurredAt, active.dispatchedAt, 'timeout');

            if (
                Date.parse(event.occurredAt) - Date.parse(active.dispatchedAt) <
                ledSetPowerTimeoutMs
            ) {
                throw new InvalidLifecycleTransitionError(
                    `Command timeout must occur at least ${ledSetPowerTimeoutMs} ms after dispatch.`,
                );
            }

            updatedAt = event.occurredAt;
            moveToRecent({
                ...active,
                status: 'timed_out',
                timedOutAt: event.occurredAt,
                reason: event.payload.reason,
            });

            return build(event.occurredAt);
        },
        getProjection(options = {}) {
            return build(options.evaluatedAt ?? updatedAt);
        },
    };

    function requireDevice(deviceId: string): DeviceProjection {
        const device = projections.get(deviceId);

        if (!device || !definitions.has(deviceId)) {
            throw new Error(`Unknown device: ${deviceId}`);
        }

        return device;
    }

    function build(evaluatedAt: string): RoomProjection {
        return {
            updatedAt,
            devices: [...projections.values()].map((device) => {
                const active = activeByDeviceId.get(device.deviceId);

                return {
                    ...withFreshness(device, evaluatedAt, freshnessThresholdsByRole),
                    ...(active ? { activeCommandId: active.commandId } : {}),
                };
            }),
            activeCommands: [...activeByDeviceId.values()],
            recentCommands: [...recent],
        };
    }

    function moveToRecent(command: TerminalCommandProjection): void {
        activeByDeviceId.delete(command.deviceId);
        addRecent(command);
    }

    function addRecent(command: TerminalCommandProjection): void {
        recent.push(command);
        recent.sort((left, right) => terminalTimestamp(right) - terminalTimestamp(left));
        recent.splice(20);
    }

    function requireActive(deviceId: string, commandId: string): ActiveCommandProjection {
        const active = activeByDeviceId.get(deviceId);

        if (!active || active.commandId !== commandId) {
            throw new InvalidLifecycleTransitionError(`No active command ${commandId}.`);
        }

        return active;
    }

    function assertUnusedCommandId(commandId: string): void {
        if (
            [...activeByDeviceId.values(), ...recent].some(
                (command) => command.commandId === commandId,
            )
        ) {
            throw new InvalidLifecycleTransitionError(`Command ${commandId} already exists.`);
        }
    }
}

function bootstrap(device: DeviceDefinition, at: string): DeviceProjection {
    return {
        deviceId: device.deviceId,
        name: device.name,
        role: device.role,
        availability: 'unknown',
        availabilityChangedAt: at,
        health: 'unknown',
        healthChangedAt: at,
        reportedState: {},
        observationStatus:
            device.role === 'temperature-sensor' ? { temperature: { freshness: 'unknown' } } : {},
        commandAvailability: commandAvailabilityFor(device.role, 'unknown', 'unknown'),
    };
}

function withObservation(
    device: DeviceProjection,
    capability: string,
    observedAt: string,
    reportedState: DeviceState,
): DeviceProjection {
    const freshness =
        device.role === 'temperature-sensor' && capability === 'temperature' ? 'fresh' : 'unknown';

    return {
        ...device,
        reportedState,
        observationStatus: {
            ...device.observationStatus,
            [capability]: { freshness, lastObservedAt: observedAt },
        },
        commandAvailability: commandAvailabilityFor(
            device.role,
            device.availability,
            device.health,
            device.healthReason,
        ),
    };
}


function isLater(value: string, reference: string): boolean {
    return Date.parse(value) > Date.parse(reference);
}

function isOnOrAfter(value: string, reference: string): boolean {
    return Date.parse(value) >= Date.parse(reference);
}

function assertChronological(value: string, reference: string, action: string): void {
    if (!isOnOrAfter(value, reference)) {
        throw new InvalidLifecycleTransitionError(`${action} cannot precede its command.`);
    }
}

function toTemperatureReportedState(payload: TelemetryReadingRecordedPayload): DeviceState {
    return { temperature: payload.value, temperatureUnit: payload.unit };
}

function matchesSetPowerCommand(command: ActiveCommandProjection, state: DeviceState): boolean {
    return command.commandType === 'set.power' && state.power === command.requestedState.power;
}

function toRejectedCommandFailure(event: CommandFailedEvent): TerminalCommandProjection {
    const { commandType, requestedState, requestedAt } = event.payload;

    if (!commandType || !requestedState || !requestedAt) {
        throw new InvalidLifecycleTransitionError(
            `No rejected-command context for ${event.commandId}.`,
        );
    }

    assertChronological(event.occurredAt, requestedAt, 'failure');

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

function terminalTimestamp(command: TerminalCommandProjection): number {
    return Date.parse(
        command.status === 'confirmed'
            ? command.confirmedAt
            : command.status === 'failed'
              ? command.failedAt
              : command.timedOutAt,
    );
}

const defaultFreshnessThresholdsByRole: FreshnessThresholdsByRole = {
    'temperature-sensor': { staleAfterMs: 2_500 },
};
export const ledSetPowerTimeoutMs = 5_000;
