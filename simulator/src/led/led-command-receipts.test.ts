import { describe, expect, it } from 'vitest';

import type {
    LedCommandReceiptPort,
    LedCommandReceiptV1,
    LedReceiptOperationOutcome,
} from './led-command-receipts';
import { createLedScenario } from './led-scenarios';
import type { LedSetPowerCommand } from './led-simulator';

describe('durable LED command receipts', () => {
    it('uses one durable delayed plan for an identical retry and rejects a payload conflict', () => {
        const port = createReceiptPort();
        const timer = createTimer();
        const scenario = createScenario(port, timer, 'confirm_delayed');
        const reports: unknown[] = [];
        scenario.onStateReport((report) => reports.push(report));

        expect(scenario.receive(command('on'), durableContext())).toEqual({
            status: 'accepted',
            acceptedAt: '2026-08-05T10:00:00.000Z',
        });
        expect(scenario.receive(command('on'), durableContext())).toEqual({
            status: 'accepted',
            acceptedAt: '2026-08-05T10:00:00.000Z',
        });
        expect(timer.size()).toBe(1);
        expect(scenario.receive(command('off'), durableContext())).toEqual({
            status: 'not_accepted',
            reason: 'source_command_identity_conflict',
        });

        timer.advanceBy(2_000);
        expect(reports).toHaveLength(1);
        expect(reports[0]).toMatchObject({
            messageId: 'simulator-led:led-main-native:cmd-1:state_report',
            reportedAt: '2026-08-05T10:00:02.000Z',
        });
    });

    it('restores a non-terminal durable receipt with its original overdue outcome identity', () => {
        const port = createReceiptPort();
        const firstTimer = createTimer();
        const first = createScenario(port, firstTimer, 'confirm_delayed');
        first.receive(command('on'), durableContext());
        first.stop();

        const restoredTimer = createTimer();
        restoredTimer.clock.advanceBy(3_000);
        const restored = createScenario(port, restoredTimer, 'confirm_immediately');
        const reports: unknown[] = [];
        restored.onStateReport((report) => reports.push(report));

        restored.restoreDurablePlans();

        expect(reports).toEqual([
            expect.objectContaining({
                messageId: 'simulator-led:led-main-native:cmd-1:state_report',
                reportedAt: '2026-08-05T10:00:02.000Z',
            }),
        ]);
        expect(port.receipts.get('cmd-1')?.terminalAt).toBe('2026-08-05T10:00:03.000Z');
    });

    it('re-emits a terminal durable plan with the same identity after a simulator restart', () => {
        const port = createReceiptPort();
        const firstTimer = createTimer();
        const first = createScenario(port, firstTimer, 'confirm_immediately');
        first.receive(command('on'), durableContext());
        first.stop();

        const restored = createScenario(port, createTimer(), 'confirm_delayed');
        const reports: unknown[] = [];
        restored.onStateReport((report) => reports.push(report));
        restored.restoreDurablePlans();

        expect(reports).toEqual([
            expect.objectContaining({
                messageId: 'simulator-led:led-main-native:cmd-1:state_report',
                reportedAt: '2026-08-05T10:00:00.000Z',
            }),
        ]);
    });

    it('does not use a durable receipt for volatile work and deduplicates it only in-process', () => {
        const port = createReceiptPort();
        const timer = createTimer();
        const scenario = createScenario(port, timer, 'confirm_delayed');

        scenario.receive(command('on'), {
            deliveryKind: 'volatile',
            attemptedAt: timer.clock.now(),
        });
        scenario.receive(command('on'), {
            deliveryKind: 'volatile',
            attemptedAt: timer.clock.now(),
        });

        expect(port.acceptCalls).toBe(0);
        expect(port.markCalls).toBe(0);
        expect(timer.size()).toBe(1);
    });

    it('emits a persisted outcome once after a terminal-marker rollback and later reconciles it', () => {
        const port = createReceiptPort();
        const timer = createTimer();
        const failures: string[] = [];
        const scenario = createLedScenario({
            deviceId: 'led-main-native',
            initialPower: 'off',
            scenario: 'confirm_immediately',
            clock: timer.clock,
            scheduler: timer,
            receiptPort: port,
            onReceiptFailure(failure) {
                failures.push(failure.operation);
            },
        });
        const reports: unknown[] = [];
        scenario.onStateReport((report) => reports.push(report));
        port.nextMarkOutcome = { status: 'confirmed_rolled_back', error: new Error('busy') };

        scenario.receive(command('on'), durableContext());
        scenario.resumeAfterStorageRecovery();

        expect(failures).toEqual(['mark_terminal']);
        expect(reports).toHaveLength(1);
        expect(port.receipts.get('cmd-1')?.terminalAt).toBe('2026-08-05T10:00:00.000Z');
    });
});

function createScenario(
    port: ReceiptPort,
    timer: TestTimer,
    scenario: 'confirm_immediately' | 'confirm_delayed',
) {
    return createLedScenario({
        deviceId: 'led-main-native',
        initialPower: 'off',
        scenario,
        clock: timer.clock,
        scheduler: timer,
        receiptPort: port,
    });
}

function command(power: 'on' | 'off'): LedSetPowerCommand {
    return {
        messageType: 'led.command.set_power',
        commandId: 'cmd-1',
        deviceId: 'led-main-native',
        commandType: 'set.power',
        requestedState: { power },
    };
}

function durableContext() {
    return { deliveryKind: 'durable_outbox' as const, attemptedAt: '2026-08-05T10:00:00.000Z' };
}

class ReceiptPort implements LedCommandReceiptPort {
    readonly receipts = new Map<string, LedCommandReceiptV1>();
    acceptCalls = 0;
    markCalls = 0;
    nextMarkOutcome: LedReceiptOperationOutcome<void> | undefined;

    accept(receipt: LedCommandReceiptV1) {
        this.acceptCalls += 1;
        const existing = this.receipts.get(receipt.commandId);

        if (existing) {
            return { status: 'committed' as const, value: { receipt: existing, inserted: false } };
        }

        this.receipts.set(receipt.commandId, receipt);

        return { status: 'committed' as const, value: { receipt, inserted: true } };
    }

    markTerminal(receipt: LedCommandReceiptV1) {
        this.markCalls += 1;
        const configured = this.nextMarkOutcome;
        this.nextMarkOutcome = undefined;

        if (configured) {
            return configured;
        }

        this.receipts.set(receipt.commandId, receipt);

        return { status: 'committed' as const, value: undefined };
    }

    list() {
        return { status: 'committed' as const, value: [...this.receipts.values()] };
    }
}

interface TestTimer {
    readonly clock: { now(): string; advanceBy(milliseconds: number): void };
    setTimeout(callback: () => void, delayMs: number): number;
    clearTimeout(timerHandle: number): void;
    advanceBy(milliseconds: number): void;
    size(): number;
}

function createTimer(): TestTimer {
    let now = Date.parse('2026-08-05T10:00:00.000Z');
    let nextId = 0;
    const callbacks = new Map<number, { dueAt: number; callback: () => void }>();
    const clock = {
        now: () => new Date(now).toISOString(),
        advanceBy(milliseconds: number) {
            now += milliseconds;
        },
    };

    return {
        clock,
        setTimeout(callback, delayMs) {
            const id = ++nextId;
            callbacks.set(id, { dueAt: now + delayMs, callback });

            return id;
        },
        clearTimeout(timerHandle) {
            callbacks.delete(timerHandle);
        },
        advanceBy(milliseconds) {
            clock.advanceBy(milliseconds);

            for (const [id, scheduled] of [...callbacks]) {
                if (scheduled.dueAt <= now) {
                    callbacks.delete(id);
                    scheduled.callback();
                }
            }
        },
        size() {
            return callbacks.size;
        },
    };
}

function createReceiptPort(): ReceiptPort {
    return new ReceiptPort();
}
