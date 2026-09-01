import type { PlatformEvent } from '@smart-room/contracts/events';

import type { EventIngress } from '../platform/event-processing/event-processor';

export interface CoordinatedRoomInput<Context = undefined> {
    event: PlatformEvent;
    ingress: EventIngress;
    context: Context | undefined;
}

export interface RoomInputCoordinator<Result, Context = undefined> {
    receive(event: PlatformEvent, context?: Context): Result | undefined;
    receiveAt(event: PlatformEvent, receivedAt: string, context?: Context): Result | undefined;
    receiveTimer(dispatch: (ingress: EventIngress) => void): void;
}

/** Serializes source callbacks while assigning ingress time before queueing. */
export function createRoomInputCoordinator<Result, Context = undefined>({
    now,
    dispatch,
}: {
    now(): string;
    dispatch(input: CoordinatedRoomInput<Context>): Result;
}): RoomInputCoordinator<Result, Context> {
    const queue: Array<
        | { kind: 'event'; input: CoordinatedRoomInput<Context>; result?: Result }
        | { kind: 'timer'; ingress: EventIngress; dispatch: (ingress: EventIngress) => void }
    > = [];
    let ingestSequence = 0;
    let draining = false;

    return {
        receive(event, context) {
            return receiveAt(event, now(), context);
        },
        receiveAt,
        receiveTimer(timerDispatch) {
            queue.push({
                kind: 'timer',
                ingress: { receivedAt: now(), ingestSequence: ++ingestSequence },
                dispatch: timerDispatch,
            });

            drainQueue();
        },
    };

    function receiveAt(
        event: PlatformEvent,
        receivedAt: string,
        context?: Context,
    ): Result | undefined {
        const queued: { kind: 'event'; input: CoordinatedRoomInput<Context>; result?: Result } = {
            kind: 'event',
            input: {
                event,
                ingress: { receivedAt, ingestSequence: ++ingestSequence },
                context,
            },
        };
        queue.push(queued);

        drainQueue();

        return queued.result;
    }

    function drainQueue(): void {
        if (draining) {
            return;
        }

        draining = true;

        try {
            while (queue.length > 0) {
                const queuedInput = queue.shift();

                if (!queuedInput) {
                    continue;
                }

                if (queuedInput.kind === 'event') {
                    queuedInput.result = dispatch(queuedInput.input);
                } else {
                    queuedInput.dispatch(queuedInput.ingress);
                }
            }
        } finally {
            draining = false;
        }
    }
}
