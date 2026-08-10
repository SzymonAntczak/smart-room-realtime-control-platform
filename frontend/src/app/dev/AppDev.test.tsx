import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppDev, updateScenarioRequestCounts } from './AppDev';

describe('AppDev', () => {
    beforeEach(() => {
        MockWebSocket.instances.length = 0;
        vi.stubGlobal('WebSocket', MockWebSocket);
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
        render(<AppDev />);
        act(() => MockWebSocket.latest().emitMessage(createRoomSnapshotMessage()));

        const trigger = screen.getByRole('button', { name: 'Dev scenarios' });
        await user.click(trigger);

        expect(
            await screen.findByRole('heading', { name: 'Temperature scenarios' }),
        ).toBeInTheDocument();
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'http://localhost:4310/dev/devices/temp-desk/scenarios',
        );

        await user.click(screen.getByRole('button', { name: 'Close panel' }));

        expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
        await Promise.resolve();
        expect(trigger).toHaveFocus();
    });

    it('closes the panel with Escape and restores trigger focus', async () => {
        const user = userEvent.setup();
        render(<AppDev />);
        act(() => MockWebSocket.latest().emitMessage(createRoomSnapshotMessage()));

        const trigger = screen.getByRole('button', { name: 'Dev scenarios' });
        await user.click(trigger);
        await screen.findByRole('heading', { name: 'Temperature scenarios' });
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
        await Promise.resolve();
        expect(trigger).toHaveFocus();
    });

    it('keeps a device locked until every outstanding scenario request finishes', () => {
        const firstRequest = updateScenarioRequestCounts(new Map(), 'led-main', true);
        const secondRequest = updateScenarioRequestCounts(firstRequest, 'led-main', true);
        const firstCompletion = updateScenarioRequestCounts(secondRequest, 'led-main', false);
        const secondCompletion = updateScenarioRequestCounts(firstCompletion, 'led-main', false);

        expect(firstCompletion.get('led-main')).toBe(1);
        expect(secondCompletion.has('led-main')).toBe(false);
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
        render(<AppDev />);
        act(() =>
            MockWebSocket.latest().emitMessage(createRoomSnapshotMessage([createLedDevice()])),
        );

        await user.click(screen.getByRole('button', { name: 'Dev scenarios' }));
        await user.click(await screen.findByRole('button', { name: 'Confirm after 2 seconds' }));

        expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();

        resolveScenario?.();

        expect(await screen.findByRole('button', { name: 'Turn on' })).toBeEnabled();
    });
});

class MockWebSocket extends EventTarget {
    static instances: MockWebSocket[] = [];

    constructor() {
        super();
        MockWebSocket.instances.push(this);
    }

    static latest(): MockWebSocket {
        const instance = MockWebSocket.instances.at(-1);

        if (!instance) {
            throw new Error('No mock websocket instance was created.');
        }

        return instance;
    }

    emitMessage(data: unknown): void {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
    }

    close(): void {
        this.dispatchEvent(new Event('close'));
    }
}

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
            devices,
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
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        reportedState: { temperature: 22.4, temperatureUnit: 'celsius' },
        commandAvailability: { policy: 'block', reason: 'read_only_device' },
        observationStatus: {
            temperature: {
                freshness: 'fresh',
                lastObservedAt: '2026-06-08T09:30:00Z',
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
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        reportedState: { power: 'off' },
        commandAvailability: { policy: 'allow' },
        observationStatus: {
            power: {
                freshness: 'fresh',
                lastObservedAt: '2026-06-08T09:30:00Z',
            },
        },
    };
}
