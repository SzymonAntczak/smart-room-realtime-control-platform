import { clearInterval, setInterval } from 'node:timers';
import type { TemperatureSensorSimulator } from './temperature-sensor';

export interface Clock {
    now(): string;
}

export interface TimerScheduler<TimerHandle = unknown> {
    setInterval(callback: () => void, intervalMs: number): TimerHandle;
    clearInterval(timerHandle: TimerHandle): void;
}

export interface TemperatureSensorRuntimeConfig<TimerHandle = unknown> {
    sensor: TemperatureSensorSimulator;
    intervalMs: number;
    clock?: Clock;
    timer?: TimerScheduler<TimerHandle>;
}

export interface TemperatureSensorRuntime {
    start(): void;
    stop(): void;
    isRunning(): boolean;
}

const realClock: Clock = {
    now() {
        return new Date().toISOString();
    },
};

const realTimer: TimerScheduler<ReturnType<typeof setInterval>> = {
    setInterval(callback, intervalMs) {
        return setInterval(callback, intervalMs);
    },
    clearInterval(timerHandle) {
        clearInterval(timerHandle);
    },
};

export function createTemperatureSensorRuntime<TimerHandle = unknown>({
    sensor,
    intervalMs,
    clock = realClock,
    timer = realTimer as TimerScheduler<TimerHandle>,
}: TemperatureSensorRuntimeConfig<TimerHandle>): TemperatureSensorRuntime {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
        throw new RangeError('Temperature sensor runtime intervalMs must be a positive number.');
    }

    let activeTimer: TimerHandle | undefined;

    return {
        start() {
            if (activeTimer !== undefined) {
                return;
            }

            activeTimer = timer.setInterval(() => {
                sensor.tick(clock.now());
            }, intervalMs);
        },
        stop() {
            if (activeTimer === undefined) {
                return;
            }

            timer.clearInterval(activeTimer);
            activeTimer = undefined;
        },
        isRunning() {
            return activeTimer !== undefined;
        },
    };
}
