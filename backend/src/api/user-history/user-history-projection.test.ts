import type { TerminalCommandProjection } from '@smart-room/contracts/commands';
import type { RecentEventProjection } from '@smart-room/contracts/history';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import {
    isRoomSnapshotProjection,
    type RoomPublicationBatch,
} from '@smart-room/contracts/realtime';
import { isRoomBffRealtimeServerMessage, isRoomBffSnapshot } from '@smart-room/contracts/room-bff';
import { isUserHistoryProjection } from '@smart-room/contracts/user-history';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { describe, expect, it } from 'vitest';

import { createTemperatureRoomRuntime } from '../../runtime/temperature-room-runtime';

import { toRoomBffPublicationDeltas, toRoomBffSnapshot } from './user-history-projection';

const timestamp = '2026-09-10T10:00:00.000Z';
const later = '2026-09-10T10:00:01.000Z';

function rawSnapshot(): RoomSnapshotProjection {
    const snapshot = createUserHistoryFixtures().snapshot;

    return {
        roomName: snapshot.roomName,
        updatedAt: snapshot.updatedAt,
        devices: snapshot.devices,
        activeCommands: snapshot.activeCommands,
        recentCommands: snapshot.recentCommands,
        recentEvents: [],
        platform: snapshot.platform,
    };
}

function withReportedPower(snapshot: RoomSnapshotProjection, power: 'on' | 'off') {
    return {
        ...snapshot,
        devices: snapshot.devices.map((device) =>
            device.deviceId === 'led-main' ? { ...device, reportedState: { power } } : device,
        ),
    };
}

function firstDevice(snapshot: RoomSnapshotProjection) {
    const device = snapshot.devices[0];

    if (!device) {
        throw new Error('Expected a device in the test room snapshot.');
    }

    return device;
}

function recordId(index: number): string {
    return `rec:v1:sha256:${index.toString(16).padStart(64, '0')}`;
}

function stateFact(
    index: number,
    power: 'on' | 'off',
    occurredAt = timestamp,
): RecentEventProjection {
    return {
        recordId: recordId(index),
        eventType: 'device.state.reported',
        occurredAt,
        source: 'simulator-adapter',
        durability: 'durable',
        storageSequence: index,
        deviceId: 'led-main',
        payload: { reportedState: { power } },
    };
}

function commandDelta(
    snapshot: RoomSnapshotProjection,
    events: RecentEventProjection[],
): RoomPublicationBatch {
    return {
        snapshot,
        deltas: [
            {
                messageType: 'commands.updated',
                payload: {
                    devices: snapshot.devices,
                    activeCommands: snapshot.activeCommands,
                    recentCommands: snapshot.recentCommands,
                    recentEvents: events,
                },
            },
        ],
    };
}

function updatedPowerSnapshot(
    previous: RoomSnapshotProjection,
    event: RecentEventProjection,
    power: 'on' | 'off',
): RoomSnapshotProjection {
    return {
        ...previous,
        updatedAt: later,
        devices: previous.devices.map((device) =>
            device.deviceId === 'led-main'
                ? {
                      ...device,
                      reportedState: { power },
                      observationStatus: {
                          ...device.observationStatus,
                          power: {
                              freshness: 'unknown',
                              lastObservedAt: event.occurredAt,
                              durability: event.durability,
                          },
                      },
                  }
                : device,
        ),
        recentEvents: [event],
    };
}

function failedFact(index: number, requestedPower?: 'on' | 'off'): RecentEventProjection {
    return {
        recordId: recordId(index),
        eventType: 'command.failed',
        occurredAt: timestamp,
        source: 'backend',
        durability: 'durable',
        storageSequence: index,
        deviceId: 'led-main',
        commandId: `cmd-${index}`,
        payload: {
            reason: 'known_device_rejection',
            message: 'diagnostic text stays private',
            ...(requestedPower
                ? {
                      commandType: 'set.power' as const,
                      requestedState: { power: requestedPower },
                      requestedAt: timestamp,
                  }
                : {}),
        },
    };
}

function timedOutCommand(commandId: string, power: 'on' | 'off'): TerminalCommandProjection {
    return {
        commandId,
        deviceId: 'led-main',
        commandType: 'set.power',
        requestedState: { power },
        requestedAt: timestamp,
        status: 'timed_out',
        timedOutAt: later,
        reason: 'deadline_elapsed',
        delivery: { status: 'handed_off', dispatchedAt: timestamp, deadlineAt: later },
        durability: 'durable',
        lifecycleDurability: 'durable',
    };
}

function timedOutFact(index: number, commandId: string): RecentEventProjection {
    return {
        recordId: recordId(index),
        eventType: 'command.timed_out',
        occurredAt: later,
        source: 'backend',
        durability: 'durable',
        storageSequence: index,
        deviceId: 'led-main',
        commandId,
        payload: { timeoutMs: 5_000, reason: 'deadline_elapsed' },
    };
}

function requestedFact(
    index: number,
    commandId: string,
    power: 'on' | 'off',
): RecentEventProjection {
    return {
        recordId: recordId(index),
        eventType: 'command.requested',
        occurredAt: timestamp,
        source: 'backend',
        durability: 'durable',
        storageSequence: index,
        deviceId: 'led-main',
        commandId,
        payload: {
            commandType: 'set.power',
            requestedState: { power },
            requestedBy: 'user',
        },
    };
}

function confirmationFact(index: number, occurredAt = later): RecentEventProjection {
    return {
        recordId: recordId(index),
        eventType: 'command.confirmed',
        occurredAt,
        source: 'backend',
        durability: 'durable',
        storageSequence: index,
        deviceId: 'led-main',
        commandId: 'cmd-confirmed',
        payload: { sourceEventId: recordId(index - 1), confirmedAt: occurredAt },
    };
}

describe('BFF user-history projection', () => {
    it('maps only proven live power, availability and health changes using actual projections', () => {
        const previous = withReportedPower(rawSnapshot(), 'off');
        const power = stateFact(1, 'on', later);
        const next = updatedPowerSnapshot(previous, power, 'on');
        const deltas = toRoomBffPublicationDeltas(previous, commandDelta(next, [power]));

        expect(deltas[0]).toMatchObject({
            messageType: 'commands.updated',
            payload: {
                userHistory: [
                    {
                        recordId: power.recordId,
                        occurredAt: power.occurredAt,
                        source: power.source,
                        deviceName: firstDevice(next).name,
                        durability: 'durable',
                        storageSequence:
                            'storageSequence' in power ? power.storageSequence : undefined,
                        kind: 'power_changed',
                        previous: 'off',
                        current: 'on',
                    },
                ],
            },
        });
        expect(
            isRoomBffRealtimeServerMessage({
                ...deltas[0],
                previousRevision: 0,
                revision: 1,
                sentAt: later,
            }),
        ).toBe(true);

        const availability = {
            recordId: recordId(2),
            eventType: 'device.availability.changed',
            occurredAt: later,
            source: 'simulator-adapter',
            durability: 'durable',
            storageSequence: 2,
            deviceId: 'led-main',
            payload: { previousAvailability: 'unknown', availability: 'offline', reason: 'test' },
        } as const satisfies RecentEventProjection;
        const health = {
            recordId: recordId(3),
            eventType: 'device.health.changed',
            occurredAt: later,
            source: 'simulator-adapter',
            durability: 'durable',
            storageSequence: 3,
            deviceId: 'led-main',
            payload: { previousHealth: 'healthy', health: 'degraded', reason: 'private' },
        } as const satisfies RecentEventProjection;
        const nextHealth = {
            ...previous,
            updatedAt: later,
            devices: previous.devices.map((device) =>
                device.deviceId === 'led-main'
                    ? {
                          ...device,
                          availability: 'offline' as const,
                          availabilityChangedAt: later,
                          availabilityReason: 'offline_reason',
                          commandAvailability: {
                              policy: 'block' as const,
                              reason: 'device_offline',
                          },
                          health: 'degraded' as const,
                          healthChangedAt: later,
                          healthReason: 'private',
                      }
                    : device,
            ),
            recentEvents: [health, availability],
        };
        const healthBatch: RoomPublicationBatch = {
            snapshot: nextHealth,
            deltas: [
                {
                    messageType: 'device.updated',
                    payload: firstDevice(nextHealth),
                    recentEvents: [health, availability],
                },
            ],
        };
        const healthDelta = toRoomBffPublicationDeltas(previous, healthBatch)[0];
        expect(healthDelta).toMatchObject({
            userHistory: [
                { kind: 'health_changed', previous: 'healthy', current: 'degraded' },
                { kind: 'availability_changed', previous: 'online', current: 'offline' },
            ],
        });
        const userHistory =
            healthDelta?.messageType === 'device.updated' && 'userHistory' in healthDelta
                ? healthDelta.userHistory
                : undefined;
        expect(JSON.stringify(userHistory)).not.toContain('private');
    });

    it('omits no-change reports and snapshot device transitions without before evidence', () => {
        const snapshot = rawSnapshot();
        const samePower = stateFact(4, 'on', later);
        const next = updatedPowerSnapshot(snapshot, samePower, 'on');
        const delta = toRoomBffPublicationDeltas(snapshot, commandDelta(next, [samePower]))[0];

        expect(delta).not.toHaveProperty('payload.userHistory');
        expect(toRoomBffSnapshot({ ...next, recentEvents: [samePower] }).userHistory).toEqual([]);
    });

    it('collapses a power report and command confirmation to one change, and omits unchanged confirmation', () => {
        const previous = withReportedPower(rawSnapshot(), 'off');
        const changed = stateFact(20, 'on', later);
        const confirmed = confirmationFact(21);
        const next = updatedPowerSnapshot(previous, changed, 'on');
        const changedBatch = commandDelta(next, [confirmed, changed]);
        const changedDelta = toRoomBffPublicationDeltas(previous, changedBatch)[0];
        const changedItems =
            changedDelta?.messageType === 'commands.updated'
                ? (changedDelta.payload.userHistory ?? [])
                : [];

        expect(changedItems).toHaveLength(1);
        expect(changedItems[0]).toMatchObject({
            kind: 'power_changed',
            previous: 'off',
            current: 'on',
        });

        const unchanged = stateFact(22, 'off', later);
        const unchangedNext = updatedPowerSnapshot(previous, unchanged, 'off');
        const unchangedBatch = commandDelta(unchangedNext, [confirmationFact(23), unchanged]);
        const unchangedDelta = toRoomBffPublicationDeltas(previous, unchangedBatch)[0];
        const unchangedItems =
            unchangedDelta?.messageType === 'commands.updated'
                ? (unchangedDelta.payload.userHistory ?? [])
                : [];

        expect(unchangedItems).toEqual([]);
    });

    it('omits ambiguous matching device reports and contradictory timeout target evidence', () => {
        const previous = withReportedPower(rawSnapshot(), 'off');
        const first = stateFact(24, 'on', later);
        const duplicate = stateFact(25, 'on', later);
        const next = updatedPowerSnapshot(previous, first, 'on');
        const ambiguous = toRoomBffPublicationDeltas(
            previous,
            commandDelta(next, [duplicate, first]),
        );
        const ambiguousHistory = ambiguous.flatMap((delta) => {
            if (delta.messageType === 'commands.updated') {
                return delta.payload.userHistory ?? [];
            }

            return 'userHistory' in delta ? (delta.userHistory ?? []) : [];
        });

        expect(ambiguousHistory).toEqual([]);

        const timeout = timedOutFact(26, 'cmd-conflict');
        const conflictingTargets = toRoomBffSnapshot({
            ...rawSnapshot(),
            recentCommands: [timedOutCommand('cmd-conflict', 'off')],
            recentEvents: [
                timeout,
                requestedFact(28, 'cmd-conflict', 'on'),
                requestedFact(27, 'cmd-conflict', 'off'),
            ],
        });

        expect(conflictingTargets.userHistory).toEqual([]);
    });

    it('keeps a prior timeout when a later independent observation changes power', () => {
        const previous = {
            ...rawSnapshot(),
            recentCommands: [timedOutCommand('cmd-late', 'on')],
            recentEvents: [timedOutFact(29, 'cmd-late'), requestedFact(30, 'cmd-late', 'on')],
        };
        const report = stateFact(31, 'off', later);
        const next = {
            ...updatedPowerSnapshot(withReportedPower(previous, 'on'), report, 'off'),
            recentCommands: previous.recentCommands,
        };
        const delta = toRoomBffPublicationDeltas(
            previous,
            commandDelta(next, [report, timedOutFact(29, 'cmd-late')]),
        )[0];

        expect(delta).toMatchObject({
            payload: {
                userHistory: [
                    { kind: 'power_changed', previous: 'on', current: 'off' },
                    { kind: 'confirmation_missing', requestedPower: 'on' },
                ],
            },
        });
    });

    it('does not replay facts already present in the previously published snapshot', () => {
        const repeated = stateFact(32, 'on', later);
        const previous = { ...withReportedPower(rawSnapshot(), 'off'), recentEvents: [repeated] };
        const next = updatedPowerSnapshot(previous, repeated, 'on');
        const delta = toRoomBffPublicationDeltas(previous, commandDelta(next, [repeated]))[0];

        expect(delta).not.toHaveProperty('payload.userHistory');
    });

    it('does not infer a device transition when only observation durability changes', () => {
        const base = withReportedPower(rawSnapshot(), 'off');
        const previous = {
            ...base,
            devices: base.devices.map((device) =>
                device.deviceId === 'led-main'
                    ? {
                          ...device,
                          observationStatus: {
                              ...device.observationStatus,
                              power: {
                                  freshness: 'unknown' as const,
                                  lastObservedAt: timestamp,
                                  durability: 'durable' as const,
                              },
                          },
                      }
                    : device,
            ),
        };
        const report = {
            recordId: recordId(33),
            eventType: 'device.state.reported',
            occurredAt: timestamp,
            source: 'simulator-adapter',
            durability: 'volatile',
            deviceId: 'led-main',
            payload: { reportedState: { power: 'off' } },
        } as const satisfies RecentEventProjection;
        const next = {
            ...previous,
            devices: previous.devices.map((device) =>
                device.deviceId === 'led-main'
                    ? {
                          ...device,
                          observationStatus: {
                              ...device.observationStatus,
                              power: {
                                  freshness: 'unknown' as const,
                                  lastObservedAt: timestamp,
                                  durability: 'volatile' as const,
                              },
                          },
                      }
                    : device,
            ),
            recentEvents: [report],
        };
        const delta = toRoomBffPublicationDeltas(previous, commandDelta(next, [report]))[0];

        expect(delta).not.toHaveProperty('payload.userHistory');
    });

    it('returns unique, descending, bounded history collections that pass the shared guard', () => {
        const events = Array.from({ length: 20 }, (_, index) => failedFact(100 + index)).reverse();
        const projected = toRoomBffSnapshot({ ...rawSnapshot(), recentEvents: events });

        expect(projected.userHistory).toHaveLength(20);
        expect(isUserHistoryProjection(projected.userHistory)).toBe(true);
        expect(new Set(projected.userHistory.map((item) => item.recordId)).size).toBe(20);
        expect(projected.userHistory.map((item) => item.recordId)).toEqual(
            events.map((event) => event.recordId),
        );
    });

    it('keeps failure, timeout and history-gap outcomes while omitting unsupported timeout targets', () => {
        const snapshot = rawSnapshot();
        const failure = failedFact(5, 'on');
        const noTargetFailure = failedFact(6);
        const timeout = {
            recordId: recordId(7),
            eventType: 'command.timed_out',
            occurredAt: later,
            source: 'backend',
            durability: 'durable',
            storageSequence: 7,
            deviceId: 'led-main',
            commandId: 'cmd-timeout',
            payload: { timeoutMs: 5_000, reason: 'private' },
        } as const satisfies RecentEventProjection;
        const orphanTimeout = {
            ...timeout,
            recordId: recordId(14),
            commandId: 'cmd-without-evidence',
        } as const satisfies RecentEventProjection;
        const gap = {
            recordId: recordId(8),
            eventType: 'storage.gap.recorded',
            occurredAt: later,
            source: 'backend',
            durability: 'durable',
            storageSequence: 8,
            payload: {
                outageStartedAt: timestamp,
                outageEndedAt: later,
                failureReason: 'private',
                boundaryBasis: 'same_process_first_degraded_at',
                observationsBackfilled: false,
            },
        } as const satisfies RecentEventProjection;
        const request = {
            recordId: recordId(9),
            eventType: 'command.requested',
            occurredAt: timestamp,
            source: 'backend',
            durability: 'durable',
            storageSequence: 9,
            deviceId: 'led-main',
            commandId: 'cmd-timeout',
            payload: {
                commandType: 'set.power',
                requestedState: { power: 'off' },
                requestedBy: 'user',
            },
        } as const satisfies RecentEventProjection;
        const result = toRoomBffSnapshot({
            ...snapshot,
            recentCommands: [timedOutCommand('cmd-timeout', 'off')],
            recentEvents: [orphanTimeout, gap, timeout, request, noTargetFailure, failure],
        });

        expect(result.userHistory.map((item) => item.kind)).toEqual([
            'history_gap',
            'confirmation_missing',
            'attempt_failed',
            'attempt_failed',
        ]);
        expect(result.userHistory[0]).toMatchObject({
            outageStartedAt: timestamp,
            outageEndedAt: later,
        });
        expect(JSON.stringify(result)).not.toContain('private');
        expect(isRoomBffSnapshot(result)).toBe(true);
    });

    it('preserves batch deltas and telemetry while suppressing recovery replay as new device history', () => {
        const previous = rawSnapshot();
        const state = stateFact(10, 'on', later);
        const next = updatedPowerSnapshot(previous, state, 'on');
        const recoveryGap = {
            recordId: recordId(11),
            eventType: 'storage.gap.recorded',
            occurredAt: later,
            source: 'backend',
            durability: 'durable',
            storageSequence: 11,
            payload: {
                outageStartedAt: timestamp,
                outageEndedAt: later,
                failureReason: 'restart',
                boundaryBasis: 'degraded_startup_at',
                observationsBackfilled: false,
            },
        } as const satisfies RecentEventProjection;
        const telemetry = {
            recordId: recordId(12),
            durability: 'durable',
            storageSequence: 12,
            deviceId: 'led-main',
            metric: 'temperature',
            value: 20,
            unit: 'celsius',
            occurredAt: later,
        } as const;
        const recovered = {
            ...next,
            platform: {
                storage: {
                    status: 'available' as const,
                    changedAt: later,
                    historyGenerationId: 'history-1',
                    storedThroughSequence: 12,
                },
            },
            recentEvents: [recoveryGap, state],
        };
        const batch: RoomPublicationBatch = {
            snapshot: recovered,
            deltas: [
                {
                    messageType: 'commands.updated',
                    payload: {
                        devices: recovered.devices,
                        activeCommands: [],
                        recentCommands: [],
                        recentEvents: [state],
                    },
                },
                {
                    messageType: 'platform.updated',
                    payload: {
                        storage: recovered.platform.storage,
                        recentEvents: [recoveryGap],
                    },
                },
                {
                    messageType: 'device.updated',
                    payload: firstDevice(recovered),
                    telemetrySample: telemetry,
                },
            ],
        };
        const deltas = toRoomBffPublicationDeltas(previous, batch);

        expect(deltas).toHaveLength(3);
        expect(deltas[0]).not.toHaveProperty('payload.userHistory');
        expect(deltas[1]).toMatchObject({ payload: { userHistory: [{ kind: 'history_gap' }] } });
        expect(deltas[2]).toMatchObject({ telemetrySample: telemetry });

        for (const [index, delta] of deltas.entries()) {
            expect(
                isRoomBffRealtimeServerMessage({
                    ...delta,
                    previousRevision: index,
                    revision: index + 1,
                    sentAt: later,
                }),
            ).toBe(true);
        }
    });

    it('uses source identity and durability, does not mutate input, and rejects invalid sources', () => {
        const previous = withReportedPower(rawSnapshot(), 'off');
        const volatile = {
            recordId: recordId(13),
            eventType: 'device.state.reported',
            occurredAt: later,
            source: 'simulator-adapter',
            durability: 'volatile',
            deviceId: 'led-main',
            payload: { reportedState: { power: 'on' } },
        } as const satisfies RecentEventProjection;
        const next = updatedPowerSnapshot(previous, volatile, 'on');
        const batch = commandDelta(next, [volatile]);
        const original = structuredClone(batch);
        const delta = toRoomBffPublicationDeltas(previous, batch)[0];

        expect(delta).toMatchObject({
            payload: {
                userHistory: [
                    {
                        recordId: volatile.recordId,
                        occurredAt: volatile.occurredAt,
                        source: volatile.source,
                        deviceName: firstDevice(next).name,
                        durability: 'volatile',
                    },
                ],
            },
        });
        expect(batch).toEqual(original);
        expect(() =>
            toRoomBffSnapshot({
                ...previous,
                recentEvents: [
                    { ...volatile, storageSequence: 1 },
                ] as unknown as RecentEventProjection[],
            }),
        ).toThrow(/Invalid snapshot/);
    });

    it('transforms a batch captured from the runtime public subscription', () => {
        const runtime = createTemperatureRoomRuntime({ intervalMs: 60_000 });
        const batches: RoomPublicationBatch[] = [];
        const unsubscribe = runtime.subscribeRoomPublicationBatch((batch) => batches.push(batch));

        try {
            runtime.start();
            const previous = runtime.getRoomSnapshot();
            expect(isRoomSnapshotProjection(previous)).toBe(true);
            batches.length = 0;

            runtime.runDeviceScenario('led-main', 'disconnect_device');

            const batch = batches[0];

            if (!batch) {
                throw new Error('Expected the runtime scenario to publish a batch.');
            }

            const deltas = toRoomBffPublicationDeltas(previous, batch);
            expect(deltas).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        messageType: 'device.updated',
                        userHistory: [
                            expect.objectContaining({
                                kind: 'availability_changed',
                                current: 'offline',
                            }),
                        ],
                    }),
                ]),
            );
        } finally {
            unsubscribe();
            runtime.stop();
        }
    });
});
