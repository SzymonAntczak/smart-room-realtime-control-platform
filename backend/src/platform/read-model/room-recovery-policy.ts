import { selectRecentCommands } from '@smart-room/contracts/commands';
import type { PlatformEvent } from '@smart-room/contracts/events';

import type { PreparedRecord } from '../event-processing/event-processor';
import { commandAvailabilityFor } from '../read-model/command-availability';
import type { RoomProjection, RoomProjectionEvidence } from '../read-model/room-projection';
import type { AcceptedInputIdentity, RuntimeSession } from '../storage/room-storage';

interface PendingStartupVolatileCommandFailure {
    event: Extract<PlatformEvent, { eventType: 'command.failed' }>;
    acceptedAt: string;
    processingEvidence: Extract<
        NonNullable<
            Extract<PreparedRecord, { kind: 'input_significant_fact' }>['processingEvidence']
        >,
        { kind: 'command_intent' }
    >;
}

const volatileCommandLostOnRestartReason = 'volatile_command_lost_on_restart';

function isStrictlyLaterTimestamp(
    candidate: string | undefined,
    baseline: string | undefined,
): boolean {
    if (candidate === undefined) {
        return false;
    }

    if (baseline === undefined) {
        return true;
    }

    return Date.parse(candidate) > Date.parse(baseline);
}

export function conservativeSessionGapStart(
    sessions: readonly RuntimeSession[],
): string | undefined {
    let earliestBound: string | undefined;

    for (const session of sessions) {
        const sessionBound =
            Date.parse(session.sessionStartedAt) >= Date.parse(session.lastDurableCommitAt)
                ? session.sessionStartedAt
                : session.lastDurableCommitAt;

        if (!earliestBound || Date.parse(sessionBound) < Date.parse(earliestBound)) {
            earliestBound = sessionBound;
        }
    }

    return earliestBound;
}

export function withBootstrapDurability(
    projection: RoomProjection,
    durability: 'durable' | 'volatile',
): RoomProjection {
    return {
        ...projection,
        devices: projection.devices.map((device) => ({
            ...device,
            ...(device.availability === 'unknown' ? { availabilityDurability: durability } : {}),
            ...(device.health === 'unknown' ? { healthDurability: durability } : {}),
            observationStatus: Object.fromEntries(
                Object.entries(device.observationStatus).map(([capability, observation]) => [
                    capability,
                    observation.lastObservedAt ? observation : { ...observation, durability },
                ]),
            ) as typeof device.observationStatus,
        })),
    };
}

export function mergeRecoveryProjection(
    durable: RoomProjection,
    volatile: RoomProjection,
): RoomProjection {
    const volatileDevices = new Map(volatile.devices.map((device) => [device.deviceId, device]));
    const durableCommands = [...durable.activeCommands, ...durable.recentCommands];
    const volatileCommands = [...volatile.activeCommands, ...volatile.recentCommands];
    const commands = new Map(durableCommands.map((command) => [command.commandId, command]));

    for (const command of volatileCommands) {
        const durableCommand = commands.get(command.commandId);

        if (!durableCommand || isTerminalCommand(command) || !isTerminalCommand(durableCommand)) {
            commands.set(command.commandId, command);
        }
    }

    const mergedCommands = [...commands.values()].sort(
        (left, right) =>
            Date.parse(right.requestedAt) - Date.parse(left.requestedAt) ||
            right.commandId.localeCompare(left.commandId),
    );
    const activeCommands = mergedCommands.filter(
        (command): command is (typeof durable.activeCommands)[number] =>
            !isTerminalCommand(command),
    );
    const activeCommandIdByDevice = new Map(
        activeCommands.map((command) => [command.deviceId, command.commandId]),
    );
    const mergedDevices = durable.devices.map((durableDevice) => {
        const volatileDevice = volatileDevices.get(durableDevice.deviceId);

        if (!volatileDevice) {
            return durableDevice;
        }

        const observations = Object.fromEntries(
            [
                ...new Set([
                    ...Object.keys(durableDevice.observationStatus),
                    ...Object.keys(volatileDevice.observationStatus),
                ]),
            ].flatMap((capability) => {
                const durableObservation = durableDevice.observationStatus[capability];
                const volatileObservation = volatileDevice.observationStatus[capability];

                if (!durableObservation) {
                    return volatileObservation ? [[capability, volatileObservation]] : [];
                }

                if (!volatileObservation) {
                    return [[capability, durableObservation]];
                }

                return [
                    [
                        capability,
                        isStrictlyLaterTimestamp(
                            volatileObservation.lastObservedAt,
                            durableObservation.lastObservedAt,
                        )
                            ? volatileObservation
                            : durableObservation,
                    ],
                ];
            }),
        ) as typeof durableDevice.observationStatus;
        const volatileObservationCapabilities = new Set(
            Object.entries(observations)
                .filter(
                    ([capability, observation]) =>
                        observation === volatileDevice.observationStatus[capability],
                )
                .map(([capability]) => capability),
        );

        const mergedDevice = {
            ...durableDevice,
            reportedState: mergeRecoveryReportedState(
                durableDevice.reportedState,
                volatileDevice.reportedState,
                volatileObservationCapabilities,
            ),
            observationStatus: observations,
        };

        if (
            Date.parse(volatileDevice.availabilityChangedAt) >
            Date.parse(durableDevice.availabilityChangedAt)
        ) {
            mergedDevice.availability = volatileDevice.availability;
            mergedDevice.availabilityChangedAt = volatileDevice.availabilityChangedAt;
            mergedDevice.availabilityDurability = volatileDevice.availabilityDurability;

            if (volatileDevice.availability === 'offline') {
                mergedDevice.availabilityReason = volatileDevice.availabilityReason;
            } else {
                delete mergedDevice.availabilityReason;
            }
        }

        if (
            Date.parse(volatileDevice.healthChangedAt) > Date.parse(durableDevice.healthChangedAt)
        ) {
            mergedDevice.health = volatileDevice.health;
            mergedDevice.healthChangedAt = volatileDevice.healthChangedAt;
            mergedDevice.healthDurability = volatileDevice.healthDurability;

            if (volatileDevice.health === 'degraded') {
                mergedDevice.healthReason = volatileDevice.healthReason;
            } else {
                delete mergedDevice.healthReason;
            }
        }

        return {
            ...mergedDevice,
            commandAvailability: commandAvailabilityFor(
                mergedDevice.role,
                mergedDevice.availability,
                mergedDevice.health,
                mergedDevice.healthReason,
            ),
        };
    });

    return {
        updatedAt:
            Date.parse(volatile.updatedAt) > Date.parse(durable.updatedAt)
                ? volatile.updatedAt
                : durable.updatedAt,
        devices: mergedDevices.map((device) => {
            const activeCommandId = activeCommandIdByDevice.get(device.deviceId);
            const withoutActiveCommand = { ...device };
            delete withoutActiveCommand.activeCommandId;

            return activeCommandId === undefined
                ? withoutActiveCommand
                : { ...withoutActiveCommand, activeCommandId };
        }),
        activeCommands,
        recentCommands: selectRecentCommands(mergedCommands.filter(isTerminalCommand)),
    };
}

function mergeRecoveryReportedState(
    durable: RoomProjection['devices'][number]['reportedState'],
    volatile: RoomProjection['devices'][number]['reportedState'],
    volatileObservationCapabilities: ReadonlySet<string>,
): RoomProjection['devices'][number]['reportedState'] {
    const merged = { ...durable };

    for (const [property, value] of Object.entries(volatile)) {
        const capability = property === 'temperatureUnit' ? 'temperature' : property;

        if (volatileObservationCapabilities.has(capability)) {
            merged[property] = value;
        }
    }

    return merged;
}

export function mergeRecoveryEvidence(
    durableEvidence: RoomProjectionEvidence,
    volatileEvidence: RoomProjectionEvidence,
    durable: RoomProjection,
    volatile: RoomProjection,
): RoomProjectionEvidence {
    const durableDevices = new Map(durable.devices.map((device) => [device.deviceId, device]));
    const durableAvailability = new Set(durableEvidence.availabilityDeviceIds);
    const volatileAvailability = new Set(volatileEvidence.availabilityDeviceIds);
    const durableHealth = new Set(durableEvidence.healthDeviceIds);
    const volatileHealth = new Set(volatileEvidence.healthDeviceIds);
    const availabilityDeviceIds = new Set<string>();
    const healthDeviceIds = new Set<string>();

    for (const volatileDevice of volatile.devices) {
        const durableDevice = durableDevices.get(volatileDevice.deviceId);

        if (!durableDevice) {
            if (volatileAvailability.has(volatileDevice.deviceId)) {
                availabilityDeviceIds.add(volatileDevice.deviceId);
            }

            if (volatileHealth.has(volatileDevice.deviceId)) {
                healthDeviceIds.add(volatileDevice.deviceId);
            }

            continue;
        }

        const newerAvailability =
            Date.parse(volatileDevice.availabilityChangedAt) >
            Date.parse(durableDevice.availabilityChangedAt);
        const newerHealth =
            Date.parse(volatileDevice.healthChangedAt) > Date.parse(durableDevice.healthChangedAt);

        if (
            (newerAvailability && volatileAvailability.has(volatileDevice.deviceId)) ||
            (!newerAvailability && durableAvailability.has(volatileDevice.deviceId))
        ) {
            availabilityDeviceIds.add(volatileDevice.deviceId);
        }

        if (
            (newerHealth && volatileHealth.has(volatileDevice.deviceId)) ||
            (!newerHealth && durableHealth.has(volatileDevice.deviceId))
        ) {
            healthDeviceIds.add(volatileDevice.deviceId);
        }
    }

    const confirmationSources = new Map(
        durableEvidence.commandConfirmationSources?.map((source) => [source.commandId, source]) ??
            [],
    );

    for (const source of volatileEvidence.commandConfirmationSources ?? []) {
        if (!confirmationSources.has(source.commandId)) {
            confirmationSources.set(source.commandId, source);
        }
    }

    return {
        availabilityDeviceIds: [...availabilityDeviceIds].sort(),
        healthDeviceIds: [...healthDeviceIds].sort(),
        commandConfirmationSources: [...confirmationSources.values()].sort((left, right) =>
            left.commandId.localeCompare(right.commandId),
        ),
    };
}

function isTerminalCommand(
    command: RoomProjection['activeCommands'][number] | RoomProjection['recentCommands'][number],
): command is RoomProjection['recentCommands'][number] {
    return ['confirmed', 'failed', 'timed_out'].includes(command.status);
}

export function hasConflictingActiveCommands(projection: RoomProjection): boolean {
    const commandIdsByDevice = new Map<string, Set<string>>();

    for (const command of projection.activeCommands) {
        const commandIds = commandIdsByDevice.get(command.deviceId) ?? new Set<string>();
        commandIds.add(command.commandId);
        commandIdsByDevice.set(command.deviceId, commandIds);

        if (commandIds.size > 1) {
            return true;
        }
    }

    return false;
}

export function hasVolatileDurableActiveCommandConflict(
    durable: RoomProjection,
    volatile: RoomProjection,
): boolean {
    const durableByDevice = new Map(
        durable.activeCommands.map((command) => [command.deviceId, command]),
    );

    return volatile.activeCommands.some((command) => {
        const durableCommand = durableByDevice.get(command.deviceId);

        return durableCommand !== undefined && durableCommand.commandId !== command.commandId;
    });
}

export function terminalOutboxClosure(
    event: PlatformEvent,
    records: readonly PreparedRecord[],
): { commandId: string; closedAt: string } | undefined {
    if (
        event.commandId &&
        (event.eventType === 'command.failed' || event.eventType === 'command.timed_out')
    ) {
        return { commandId: event.commandId, closedAt: event.occurredAt };
    }

    const confirmation = records.find(
        (record): record is Extract<PreparedRecord, { kind: 'derived_command_confirmed' }> =>
            record.kind === 'derived_command_confirmed',
    );

    return confirmation
        ? { commandId: confirmation.commandId, closedAt: confirmation.occurredAt }
        : undefined;
}

export function promoteStartupVolatileCommandFailures(
    projection: RoomProjection,
    failures: readonly PendingStartupVolatileCommandFailure[],
): RoomProjection {
    const commandIds = new Set(failures.map((failure) => failure.event.commandId));
    const recentCommands = projection.recentCommands.map((command) => {
        if (!commandIds.has(command.commandId)) {
            return command;
        }

        if (
            command.status !== 'failed' ||
            command.reason !== volatileCommandLostOnRestartReason ||
            command.durability !== 'volatile'
        ) {
            throw new Error(
                `Startup volatile command ${command.commandId} was not restored as the expected failure.`,
            );
        }

        return { ...command, lifecycleDurability: 'durable' as const };
    });

    // recentCommands is a bounded cache. During a prolonged degraded period a
    // newer terminal command can evict this startup failure before recovery.
    // The recovery transaction persists the failure fact and identity either
    // way; only a retained terminal projection can expose a lifecycle-axis
    // promotion in the checkpoint cache.
    return { ...projection, recentCommands: selectRecentCommands(recentCommands) };
}

export function mergeVolatileGuards(
    restored: readonly AcceptedInputIdentity[],
    live: readonly AcceptedInputIdentity[],
    { asOf, retentionMs, entryLimit }: { asOf: string; retentionMs: number; entryLimit: number },
): AcceptedInputIdentity[] {
    const guards = new Map<string, AcceptedInputIdentity>();
    const cutoff = Date.parse(asOf) - retentionMs;

    for (const candidate of [...restored, ...live]) {
        if (
            candidate.durability !== 'volatile' ||
            !candidate.fingerprint.startsWith('fp:v1:sha256:') ||
            Date.parse(candidate.acceptedAt) <= cutoff
        ) {
            continue;
        }

        const existing = guards.get(candidate.eventId);

        // Keep the oldest accepted identity when an unavailable startup has
        // observed a conflicting event-id before its checkpoint could be
        // restored. Both candidates remain guards semantically; retaining the
        // earliest one makes the conflict deterministic and never promotes it
        // to a durable accepted identity.
        if (!existing || candidate.acceptedAt < existing.acceptedAt) {
            guards.set(candidate.eventId, candidate);
        }
    }

    return [...guards.values()]
        .sort(
            (left, right) =>
                left.acceptedAt.localeCompare(right.acceptedAt) ||
                left.eventId.localeCompare(right.eventId),
        )
        .slice(-entryLimit);
}
