import type {
    CommandDispatchedEvent,
    CommandRequestedEvent,
    DeviceStateReportedEvent,
} from '@smart-room/contracts/events';
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
        const prepared = processor.prepareEvent(
            matchingReport,
            { receivedAt: '2026-08-05T10:00:03Z', ingestSequence: 1 },
            'available',
        );
        const result = processor.commitPrepared(prepared);
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
        expect(prepared.records).toEqual([
            expect.objectContaining({ kind: 'input_significant_fact' }),
            expect.objectContaining({
                kind: 'derived_command_confirmed',
                commandId: 'cmd-1',
                eventId: matchingReport.eventId,
            }),
        ]);
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
            expect.objectContaining({ status: 'ignored', reason: 'invalid_lifecycle_transition' }),
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
            expect.objectContaining({ status: 'ignored', reason: 'invalid_lifecycle_transition' }),
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

    it('rejects a repeated dispatch as an invalid lifecycle transition', () => {
        const processor = createLedProcessor();
        processor.processEvent(report('off', '2026-08-05T10:00:00Z'));
        processor.processEvent(requested('cmd-1', '2026-08-05T10:00:01Z'));
        processor.processEvent(dispatched('cmd-1', '2026-08-05T10:00:02Z'));

        const result = processor.processEvent({
            eventId: 'evt-dispatched-again',
            eventType: 'command.dispatched',
            occurredAt: '2026-08-05T10:00:03Z',
            source: 'backend',
            deviceId: 'led-main',
            commandId: 'cmd-1',
            payload: { commandType: 'set.power', target: 'simulator-adapter' },
        });

        expect(result).toEqual(
            expect.objectContaining({ status: 'ignored', reason: 'invalid_lifecycle_transition' }),
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
        payload: { reportedState: { power } },
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
