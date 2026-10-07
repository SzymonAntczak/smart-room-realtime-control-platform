import { acceptedCommandResponseSchema } from '@smart-room/contracts/commands';
import { isSchema } from '@smart-room/contracts/validation';
import { describe, expect, it } from 'vitest';

import { createBackendIntegrationRuntime } from './backend-integration-runtime';

describe('LED native source through backend command HTTP and SSE', () => {
    it.each(['immediate', 'delayed', 'rejected', 'timeout', 'late report'] as const)(
        'keeps the %s command outcome explainable',
        async (outcome) => {
            const backend = await createBackendIntegrationRuntime();
            const stream = await backend.connectSse();
            backend.clock.advanceBy(1);
            expect(
                (await backend.snapshot()).devices.find((device) => device.deviceId === 'led-main')
                    ?.reportedState.power,
            ).toBe('off');

            if (outcome === 'immediate') {
                // The test explicitly supplies a device outcome during native dispatch.
                backend
                    .led()
                    .scenario.onCommand(() => backend.led().reportState('on', backend.clock.now()));
            }

            const accepted = await backend.request('/room/commands', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                }),
            });
            expect(accepted.status).toBe(202);

            if (!isSchema(acceptedCommandResponseSchema, accepted.body)) {
                throw new Error('Invalid accepted command response');
            }

            const commandId = accepted.body.commandId;
            const command = backend
                .led()
                .received.find((candidate) => candidate.commandId === commandId);

            if (!command) {
                throw new Error('Native command was not dispatched');
            }

            expect(command).toMatchObject({
                messageType: 'led.command.set_power',
                deviceId: 'led-main-native',
                requestedState: { power: 'on' },
            });
            expect(
                (await backend.snapshot()).devices.find((device) => device.deviceId === 'led-main')
                    ?.reportedState.power,
            ).toBe(outcome === 'immediate' ? 'on' : 'off');
            await stream.waitFor(
                (message) =>
                    message.messageType === 'commands.updated' &&
                    message.payload.activeCommands.some((item) => item.commandId === commandId),
            );

            if (outcome === 'delayed') {
                backend.clock.advanceBy(2000);
            }

            if (outcome === 'timeout' || outcome === 'late report') {
                backend.clock.advanceBy(5000);
            }

            if (outcome === 'rejected') {
                backend.led().reject(command, backend.clock.now());
            }

            if (outcome === 'delayed') {
                backend.led().reportState('on', backend.clock.now());
            }

            const expectedStatus =
                outcome === 'rejected'
                    ? 'failed'
                    : outcome === 'timeout' || outcome === 'late report'
                      ? 'timed_out'
                      : 'confirmed';
            await stream.waitFor(
                (message) =>
                    message.messageType === 'commands.updated' &&
                    message.payload.recentCommands.some(
                        (item) => item.commandId === commandId && item.status === expectedStatus,
                    ),
            );

            if (outcome === 'late report') {
                backend.clock.advanceBy(1000);
                backend.led().reportState('on', backend.clock.now());
            }

            const snapshot = await backend.snapshot();
            expect(snapshot.activeCommands).toEqual([]);
            expect(snapshot.recentCommands).toEqual([
                expect.objectContaining({ commandId, status: expectedStatus }),
            ]);
            expect(
                snapshot.devices.find((device) => device.deviceId === 'led-main')?.reportedState
                    .power,
            ).toBe(
                outcome === 'immediate' || outcome === 'delayed' || outcome === 'late report'
                    ? 'on'
                    : 'off',
            );
        },
    );
});
