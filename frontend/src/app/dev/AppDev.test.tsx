import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppDev } from './AppDev';

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

function createRoomSnapshotMessage() {
    return {
        messageType: 'room.snapshot',
        revision: 0,
        sentAt: '2026-06-08T09:30:01Z',
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-06-08T09:30:00Z',
            activeCommands: [],
            recentCommands: [],
            devices: [
                {
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
                },
            ],
        },
    };
}
