import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockEventSource } from '../../test/room/mock-event-source';

import { AppDev } from './AppDev';

vi.mock(
    '../pages/dashboard/history-sidebar/history-sidebar-content/history-feed/useHistoryVirtualizer',
    async () => {
        const { createRef } = await import('react');

        return {
            useHistoryVirtualizer: () => ({
                virtuosoRef: createRef(),
            }),
        };
    },
);
describe('AppDev', () => {
    beforeEach(() => {
        MockEventSource.instances.length = 0;
        vi.stubGlobal('EventSource', MockEventSource);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        deviceId: 'temp-desk',
                        scenarios: [{ action: 'pause_telemetry' }],
                    }),
                ),
            ),
        );
    });

    afterEach(() => vi.unstubAllGlobals());

    it('opens a device-scoped scenario sidebar and restores trigger focus after closing it', async () => {
        const user = userEvent.setup();
        deferHistoryRequests();
        render(<AppDev />);
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));

        const trigger = screen.getByRole('button', { name: 'Scenariusze programistyczne' });
        await user.click(trigger);

        expect(
            await screen.findByRole('heading', { name: 'Scenariusze temperatury' }),
        ).toBeInTheDocument();
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'http://localhost:4310/dev/devices/temp-desk/scenarios',
        );

        await user.click(screen.getByRole('button', { name: 'Zamknij panel' }));

        expect(
            screen.queryByRole('complementary', { name: /Scenariusze programistyczne dla/ }),
        ).not.toBeInTheDocument();
        await Promise.resolve();
        expect(trigger).toHaveFocus();
    });

    it('closes the panel with Escape and restores trigger focus', async () => {
        const user = userEvent.setup();
        deferHistoryRequests();
        render(<AppDev />);
        act(() => MockEventSource.latest().emitMessage(createRoomSnapshotMessage()));

        const trigger = screen.getByRole('button', { name: 'Scenariusze programistyczne' });
        await user.click(trigger);
        await screen.findByRole('heading', { name: 'Scenariusze temperatury' });
        await user.keyboard('{Escape}');

        expect(
            screen.queryByRole('complementary', { name: /Scenariusze programistyczne dla/ }),
        ).not.toBeInTheDocument();
        await Promise.resolve();
        expect(trigger).toHaveFocus();
    });

    it('locks the LED control while its scenario request is pending', async () => {
        let resolveScenario: (() => void) | undefined;
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            deviceId: 'led-main',
                            scenarios: [{ action: 'confirm_delayed' }],
                        }),
                    ),
                )
                .mockImplementationOnce(
                    () =>
                        new Promise<Response>((resolve) => {
                            resolveScenario = () =>
                                resolve(
                                    new Response(
                                        JSON.stringify({
                                            action: 'confirm_delayed',
                                            status: 'completed',
                                        }),
                                    ),
                                );
                        }),
                ),
        );
        const user = userEvent.setup();
        deferHistoryRequests();
        render(<AppDev />);
        act(() =>
            MockEventSource.latest().emitMessage(createRoomSnapshotMessage([createLedDevice()])),
        );

        await user.click(screen.getByRole('button', { name: 'Scenariusze programistyczne' }));
        await user.click(await screen.findByRole('button', { name: 'Potwierdź po 2 sekundach' }));

        expect(screen.getByRole('button', { name: 'Włącz' })).toBeDisabled();

        resolveScenario?.();

        expect(await screen.findByRole('button', { name: 'Włącz' })).toBeEnabled();
    });
});

function createRoomSnapshotMessage(devices: unknown[] = [createTemperatureDevice()]) {
    return {
        messageType: 'room.snapshot',
        revision: 0,
        sentAt: '2026-06-08T09:30:01Z',
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-06-08T09:30:00Z',
            activeCommands: [],
            recentCommands: [],
            userHistory: [],
            devices,
            platform: { storage: availableStorage() },
        },
    };
}

function createTemperatureDevice() {
    return {
        deviceId: 'temp-desk',
        name: 'Desk Temperature',
        role: 'temperature-sensor',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        healthDurability: 'durable',
        reportedState: { temperature: 22.4, temperatureUnit: 'celsius' },
        commandAvailability: { policy: 'block', reason: 'read_only_device' },
        observationStatus: {
            temperature: {
                freshness: 'fresh',
                lastObservedAt: '2026-06-08T09:30:00Z',
                durability: 'durable',
            },
        },
    };
}

function createLedDevice() {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        healthDurability: 'durable',
        reportedState: { power: 'off' },
        commandAvailability: { policy: 'allow' },
        observationStatus: {
            power: {
                freshness: 'fresh',
                lastObservedAt: '2026-06-08T09:30:00Z',
                durability: 'durable',
            },
        },
    };
}

function availableStorage() {
    return {
        status: 'available' as const,
        changedAt: '2026-06-08T09:30:00Z',
        historyGenerationId: 'generation-test',
        storedThroughSequence: 0,
    };
}

function deferHistoryRequests() {
    const developmentFetch = globalThis.fetch;
    vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>((input, init) =>
            String(input).includes('/room/history/')
                ? new Promise(() => undefined)
                : developmentFetch(input, init),
        ),
    );
}
