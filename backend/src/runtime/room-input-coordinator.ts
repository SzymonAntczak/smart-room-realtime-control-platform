import type { PlatformEvent } from '@smart-room/contracts/events';

import type { EventIngress } from '../platform/event-processing/event-processor';

export interface CoordinatedRoomInput {
    event: PlatformEvent;
    ingress: EventIngress;
}

export interface RoomInputCoordinator<Result> {
    receive(event: PlatformEvent): Result | undefined;
    receiveTimer(dispatch: (ingress: EventIngress) => void): void;
}

/** Serializes source callbacks while assigning ingress time before queueing. */
export function createRoomInputCoordinator<Result>({
    now,
    dispatch,
}: {
    now(): string;
    dispatch(input: CoordinatedRoomInput): Result;
}): RoomInputCoordinator<Result> {
    const queue: Array<
        | { kind: 'event'; input: CoordinatedRoomInput; result?: Result }
        | { kind: 'timer'; ingress: EventIngress; dispatch: (ingress: EventIngress) => void }
    > = [];
    let ingestSequence = 0;
    let draining = false;

    return {
        receive(event) {
            const queued: { kind: 'event'; input: CoordinatedRoomInput; result?: Result } = {
                kind: 'event',
                input: {
                    event,
                    ingress: { receivedAt: now(), ingestSequence: ++ingestSequence },
                },
            };
            queue.push(queued);

            if (draining) {
                return undefined;
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

            return queued.result;
        },
        receiveTimer(timerDispatch) {
            queue.push({
                kind: 'timer',
                ingress: { receivedAt: now(), ingestSequence: ++ingestSequence },
                dispatch: timerDispatch,
            });

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
        },
    };
}
