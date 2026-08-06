import type {
    CommandDispatchedEvent,
    CommandRequestedEvent,
    DeviceStateReportedEvent,
} from '@smart-room/contracts';
import { describe, expect, it } from 'vitest';

import { createRoomProjector } from '../read-model/room-projection';

import { createEventProcessor } from './event-processor';

describe('command lifecycle event processing', () => {
    it('projects a command request, dispatch and matching report as confirmed', () => {
        const processor = createLedProcessor();
        processor.processEvent(report('off', '2026-08-05T10:00:00Z'));
        processor.processEvent(requested('cmd-1', '2026-08-05T10:00:01Z'));
        processor.processEvent(dispatched('cmd-1', '2026-08-05T10:00:02Z'));

        const matchingReport = report('on', '2026-08-05T10:00:03Z');
        const result = processor.processEvent(matchingReport);
        const duplicateReport = processor.processEvent(matchingReport);

        expect(result).toEqual(
            expect.objectContaining({
                status: 'accepted',
                state: expect.objectContaining({
                    activeCommands: [],
                    recentCommands: [
                        expect.objectContaining({ commandId: 'cmd-1', status: 'confirmed' }),
                    ],
                }),
            }),
        );
        expect(duplicateReport).toEqual(
            expect.objectContaining({ status: 'ignored', reason: 'duplicate_event' }),
        );
    });

    it('rejects a lifecycle transition that has no matching active command', () => {
        const processor = createLedProcessor();

        const result = processor.processEvent(
            dispatched('missing-command', '2026-08-05T10:00:02Z'),
        );

        expect(result).toEqual(
            expect.objectContaining({ status: 'ignored', reason: 'invalid_payload' }),
        );
        expect(result.state.activeCommands).toEqual([]);
        expect(result.state.recentCommands).toEqual([]);
    });

    it('deduplicates an accepted command lifecycle event', () => {
        const processor = createLedProcessor();
        processor.processEvent(report('off', '2026-08-05T10:00:00Z'));
        const event = requested('cmd-1', '2026-08-05T10:00:01Z');

        processor.processEvent(event);
        const duplicate = processor.processEvent(event);

        expect(duplicate).toEqual(
            expect.objectContaining({ status: 'ignored', reason: 'duplicate_event' }),
        );
        expect(duplicate.state.activeCommands).toEqual([
            expect.objectContaining({ commandId: 'cmd-1', status: 'accepted' }),
        ]);
    });

    it('projects an explicit conflict failure without accepting a second command request', () => {
        const processor = createLedProcessor();
        processor.processEvent(report('off', '2026-08-05T10:00:00Z'));
        processor.processEvent(requested('cmd-1', '2026-08-05T10:00:01Z'));

        const conflictingRequest = processor.processEvent(
            requested('cmd-2', '2026-08-05T10:00:02Z'),
        );
        const failureEvent = {
            eventId: 'evt-failed-cmd-2',
            eventType: 'command.failed',
            occurredAt: '2026-08-05T10:00:02Z',
            source: 'backend',
            deviceId: 'led-main',
            commandId: 'cmd-2',
            payload: {
                reason: 'command_already_active',
                message: 'Device already has an active command.',
                commandType: 'set.power',
                requestedState: { power: 'on' },
                requestedAt: '2026-08-05T10:00:02Z',
            },
        };
        const failure = processor.processEvent(failureEvent);
        const duplicateFailure = processor.processEvent(failureEvent);

        expect(conflictingRequest).toEqual(
            expect.objectContaining({ status: 'ignored', reason: 'invalid_payload' }),
        );
        expect(failure).toEqual(
            expect.objectContaining({
                status: 'accepted',
                state: expect.objectContaining({
                    activeCommands: [expect.objectContaining({ commandId: 'cmd-1' })],
                    recentCommands: [
                        expect.objectContaining({
                            commandId: 'cmd-2',
                            status: 'failed',
                            reason: 'command_already_active',
                        }),
                    ],
                }),
            }),
        );
        expect(duplicateFailure).toEqual(
            expect.objectContaining({ status: 'ignored', reason: 'duplicate_event' }),
        );
    });

    it('does not accept a direct command.confirmed event for the LED reference slice', () => {
        const processor = createLedProcessor();

        const result = processor.processEvent({
            eventId: 'evt-confirmed-1',
            eventType: 'command.confirmed',
            occurredAt: '2026-08-05T10:00:03Z',
            source: 'backend',
            deviceId: 'led-main',
            commandId: 'cmd-1',
            payload: { confirmationSource: 'device.state.reported', matchedState: { power: 'on' } },
        });

        expect(result).toEqual(
            expect.objectContaining({ status: 'ignored', reason: 'unsupported_event_type' }),
        );
    });
});

function createLedProcessor() {
    const devices = [{ deviceId: 'led-main', name: 'Main LED', role: 'led-output' as const }];
    return createEventProcessor({
        devices,
        roomProjector: createRoomProjector({
            devices,
            initialUpdatedAt: '2026-08-05T09:59:59Z',
        }),
        clock: { now: () => '2026-08-05T10:00:03Z' },
    });
}

function report(power: 'on' | 'off', occurredAt: string): DeviceStateReportedEvent {
    return {
        eventId: `evt-report-${power}-${occurredAt}`,
        eventType: 'device.state.reported',
        occurredAt,
        source: 'simulator-adapter',
        deviceId: 'led-main',
        payload: { reportedState: { power }, reportedAt: occurredAt },
    };
}

function requested(commandId: string, occurredAt: string): CommandRequestedEvent {
    return {
        eventId: `evt-requested-${commandId}`,
        eventType: 'command.requested',
        occurredAt,
        source: 'backend',
        deviceId: 'led-main',
        commandId,
        payload: {
            commandType: 'set.power',
            requestedState: { power: 'on' },
            requestedBy: 'user',
        },
    };
}

function dispatched(commandId: string, occurredAt: string): CommandDispatchedEvent {
    return {
        eventId: `evt-dispatched-${commandId}`,
        eventType: 'command.dispatched',
        occurredAt,
        source: 'backend',
        deviceId: 'led-main',
        commandId,
        payload: { commandType: 'set.power', target: 'simulator-adapter' },
    };
}
