import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { describe, expect, it } from 'vitest';

import { assertMockRoomSnapshot, serializeMockSseMessage } from './mock-bff-contracts';
import {
    createCommandsUpdatedMessage,
    createConfirmedLedCommand,
    createConfirmedLedDeviceProjection,
    createDeviceUpdatedMessage,
    createFailedLedCommand,
    createFreshTemperatureAfterRecoveryDeviceProjection,
    createFreshTemperatureDeviceProjection,
    createLateReportedLedDeviceProjection,
    createOfflineTemperatureDeviceProjection,
    createOnlineLedDeviceProjection,
    createOnlineLedRoomSnapshot,
    createOnlineTemperatureDeviceProjection,
    createOnlineTemperatureRoomSnapshot,
    createPendingLedCommand,
    createPendingLedDeviceProjection,
    createPlatformUpdatedMessage,
    createRecoveredTemperatureDeviceProjection,
    createStaleTemperatureDeviceProjection,
    createStorageProjection,
    createTemperatureDeviceUpdatedMessage,
    createTimedOutLedCommand,
} from './mock-bff-fixtures';
import { MockRoomScenario } from './mock-room-scenario';

describe('browser room fixtures', () => {
    it.each([
        ['LED room', createOnlineLedRoomSnapshot],
        ['multi-sensor room', createOnlineTemperatureRoomSnapshot],
    ] as const)('provides an isolated, valid %s snapshot and SSE envelope', (_, createSnapshot) => {
        const snapshot = createSnapshot();
        const scenario = new MockRoomScenario();
        scenario.setSnapshot(snapshot);

        expect(assertMockRoomSnapshot(snapshot)).toEqual(snapshot);
        expect(serializeMockSseMessage(scenario.snapshotMessage())).toContain(
            'event: room.snapshot\n',
        );
        snapshot.devices[0].reportedState = {};
        expect(createSnapshot()).not.toEqual(snapshot);
    });

    it.each([
        ['fresh', createFreshTemperatureDeviceProjection],
        ['stale', createStaleTemperatureDeviceProjection],
        ['offline with stale data', createOfflineTemperatureDeviceProjection],
        ['recovered with stale data', createRecoveredTemperatureDeviceProjection],
        ['fresh after recovery', createFreshTemperatureAfterRecoveryDeviceProjection],
    ] as const)(
        'validates the %s temperature fixture through SSE and merged snapshots',
        (_, createDevice) => {
            const scenario = new MockRoomScenario();
            scenario.setSnapshot(createOnlineTemperatureRoomSnapshot());
            const device = createDevice();
            const update = createTemperatureDeviceUpdatedMessage(0, device);

            expect(() => serializeMockSseMessage(update)).not.toThrow();
            scenario.applyUpdate(update);
            expect(scenario.snapshotMessage().payload.devices).toContainEqual(device);
            expect(scenario.currentRevision()).toBe(1);
        },
    );

    it.each(['durable', 'volatile'] as const)(
        'validates pending and confirmed command fixtures with %s evidence',
        (durability) => {
            const scenario = new MockRoomScenario();
            const pending = createCommandsUpdatedMessage(0, {
                devices: [createPendingLedDeviceProjection()],
                activeCommands: [createPendingLedCommand(durability)],
            });
            const confirmed = createCommandsUpdatedMessage(1, {
                devices: [createConfirmedLedDeviceProjection(durability)],
                recentCommands: [createConfirmedLedCommand(durability)],
            });

            expect(() => serializeMockSseMessage(pending)).not.toThrow();
            scenario.applyUpdate(pending);
            expect(() => serializeMockSseMessage(confirmed)).not.toThrow();
            scenario.applyUpdate(confirmed);
            expect(scenario.snapshotMessage().payload.activeCommands).toEqual([]);
            expect(scenario.snapshotMessage().payload.recentCommands).toEqual([
                createConfirmedLedCommand(durability),
            ]);
            expect(scenario.currentRevision()).toBe(2);
        },
    );

    it('validates rejection, timeout and a later report without changing the terminal command', () => {
        const scenario = new MockRoomScenario();
        const failed = createFailedLedCommand('rejected-command');
        const timedOut = createTimedOutLedCommand();
        scenario.applyUpdate(createCommandsUpdatedMessage(0, { recentCommands: [failed] }));
        scenario.applyUpdate(
            createCommandsUpdatedMessage(1, {
                devices: [createPendingLedDeviceProjection()],
                activeCommands: [createPendingLedCommand()],
                recentCommands: [failed],
            }),
        );
        scenario.applyUpdate(
            createCommandsUpdatedMessage(2, {
                devices: [createOnlineLedDeviceProjection()],
                recentCommands: [timedOut, failed],
            }),
        );
        scenario.applyUpdate(
            createDeviceUpdatedMessage(3, createLateReportedLedDeviceProjection()),
        );

        expect(scenario.snapshotMessage().payload.recentCommands).toEqual([timedOut, failed]);
        expect(() => serializeMockSseMessage(scenario.snapshotMessage())).not.toThrow();
    });

    it('validates the complete storage transition with contiguous revisions and stable bounds', () => {
        const scenario = new MockRoomScenario();

        for (const [revision, status] of (
            ['available', 'degraded', 'recovering', 'available'] as const
        ).entries()) {
            const storage = createStorageProjection(status, 7);
            const update = createPlatformUpdatedMessage(revision, 7, storage.changedAt, storage);

            expect(() => serializeMockSseMessage(update)).not.toThrow();
            scenario.applyUpdate(update);
            expect(scenario.snapshotMessage().payload.platform.storage).toEqual(storage);
            expect(scenario.currentRevision()).toBe(revision + 1);
        }
    });

    it.each(['durable', 'volatile'] as const)(
        'validates a %s telemetry sample before serializing it to SSE',
        (durability) => {
            const { storageSequence, ...sample } = createHistoryIdentityFixtures().telemetrySample;
            const telemetrySample =
                durability === 'durable'
                    ? { ...sample, durability, storageSequence }
                    : { ...sample, durability };
            const message = {
                ...createTemperatureDeviceUpdatedMessage(0, {
                    ...createOnlineTemperatureDeviceProjection(),
                    reportedState: { temperature: sample.value, temperatureUnit: 'celsius' },
                    observationStatus: {
                        temperature: {
                            freshness: 'fresh',
                            lastObservedAt: sample.occurredAt,
                            durability,
                        },
                    },
                }),
                telemetrySample,
            };

            expect(() => serializeMockSseMessage(message)).not.toThrow();
            expect(() =>
                serializeMockSseMessage({
                    ...message,
                    telemetrySample: { ...telemetrySample, deviceId: 'another-sensor' },
                }),
            ).toThrow('SSE message did not match the shared contract');
        },
    );
});
