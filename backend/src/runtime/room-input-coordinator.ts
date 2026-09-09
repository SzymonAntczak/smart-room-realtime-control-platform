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
    beginRecoveryCutover(options?: { queueLimit?: number }): RecoveryCutoverToken;
    openIntake(): void;
    closeIntakeAndDrain(): RoomInputShutdownResult;
}

export type RoomInputShutdownResult =
    | { status: 'drained' }
    | { status: 'interrupted_by_recovery_cutover' | 'interrupted_while_draining' };

/**
 * A recovery cutover owns the dequeue boundary. Inputs received while it is
 * active remain unprepared until the caller releases the token.
 */
export interface RecoveryCutoverToken {
    readonly queuedInputCount: number;
    readonly overflowed: boolean;
    shouldAbort(): boolean;
    commit(): void;
    abort(): void;
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
    let intakeOpen = true;
    let discardQueuedInputs = false;
    let recoveryCutover:
        | {
              queueLimit: number;
              overflowed: boolean;
              finalized: boolean;
          }
        | undefined;

    return {
        receive(event, context) {
            return receiveAt(event, now(), context);
        },
        receiveAt,
        receiveTimer(timerDispatch) {
            if (!intakeOpen) {
                return;
            }

            queue.push({
                kind: 'timer',
                ingress: { receivedAt: now(), ingestSequence: ++ingestSequence },
                dispatch: timerDispatch,
            });
            noteRecoveryQueueSize();

            drainQueue();
        },
        beginRecoveryCutover(options = {}) {
            if (recoveryCutover) {
                throw new Error('A recovery cutover is already active.');
            }

            const cutover = {
                queueLimit: options.queueLimit ?? 1_000,
                // The boundary starts after the currently dequeued input.
                // Inputs already waiting behind it belong to the raw FIFO just
                // as much as inputs received later, so account for them before
                // exposing the token.
                overflowed: queue.length > (options.queueLimit ?? 1_000),
                finalized: false,
            };
            recoveryCutover = cutover;

            return {
                get queuedInputCount() {
                    return queue.length;
                },
                get overflowed() {
                    return cutover.overflowed;
                },
                shouldAbort() {
                    return cutover.overflowed;
                },
                commit() {
                    finalize(false);
                },
                abort() {
                    finalize(true);
                },
            };

            function finalize(aborted: boolean): void {
                if (cutover.finalized) {
                    return;
                }

                if (!aborted && cutover.overflowed) {
                    throw new Error('Recovery cutover cannot commit after its queue overflowed.');
                }

                cutover.finalized = true;

                if (recoveryCutover === cutover) {
                    recoveryCutover = undefined;
                }

                drainQueue();
            }
        },
        openIntake() {
            intakeOpen = true;
            discardQueuedInputs = false;
        },
        closeIntakeAndDrain() {
            intakeOpen = false;

            if (recoveryCutover) {
                discardQueuedInputs = true;
                queue.length = 0;

                return { status: 'interrupted_by_recovery_cutover' };
            }

            if (draining) {
                discardQueuedInputs = true;
                queue.length = 0;

                return { status: 'interrupted_while_draining' };
            }

            drainQueue();

            return { status: 'drained' };
        },
    };

    function receiveAt(
        event: PlatformEvent,
        receivedAt: string,
        context?: Context,
    ): Result | undefined {
        if (!intakeOpen) {
            return undefined;
        }

        const queued: { kind: 'event'; input: CoordinatedRoomInput<Context>; result?: Result } = {
            kind: 'event',
            input: {
                event,
                ingress: { receivedAt, ingestSequence: ++ingestSequence },
                context,
            },
        };
        queue.push(queued);
        noteRecoveryQueueSize();

        drainQueue();

        return queued.result;
    }

    function drainQueue(): void {
        if (draining) {
            return;
        }

        draining = true;

        try {
            while (queue.length > 0 && !recoveryCutover && !discardQueuedInputs) {
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

            if (discardQueuedInputs) {
                queue.length = 0;
            }
        }
    }

    function noteRecoveryQueueSize(): void {
        if (recoveryCutover && queue.length > recoveryCutover.queueLimit) {
            recoveryCutover.overflowed = true;
        }
    }
}
