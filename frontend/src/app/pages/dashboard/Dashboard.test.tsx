import { isRoomBffSnapshot } from '@smart-room/contracts/room-bff';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createLedDevice,
    createPendingCommand,
    createRoomSnapshotMessage,
    createTemperatureDevice,
} from '../../../test/room/room-realtime-fixtures';

import { Dashboard } from './Dashboard';
import type { RenderableRoomSnapshot } from './useRoom';

const roomHook = vi.hoisted(() => vi.fn());
vi.mock('./useRoom', () => ({ useRoom: roomHook }));

const historySource = {
    subscribe: () => () => undefined,
    getBaseline: () => undefined,
    requestBaseline: () => undefined,
};

function snapshot(): RenderableRoomSnapshot {
    const baseline = createRoomSnapshotMessage();
    const temperature = createTemperatureDevice();
    const observation = temperature.observationStatus.temperature;

    if (baseline.messageType !== 'room.snapshot' || !observation) {
        throw new Error('Expected a room snapshot with a temperature observation fixture.');
    }

    return {
        ...baseline.payload,
        devices: [
            {
                ...temperature,
                role: 'temperature-sensor',
                observationStatus: { ...temperature.observationStatus, temperature: observation },
            },
            { ...createLedDevice(), role: 'led-output' },
            {
                ...createLedDevice(),
                deviceId: 'led-second',
                name: 'Second LED',
                role: 'led-output',
            },
        ],
    };
}

function ready(
    view: RenderableRoomSnapshot,
    connectionStatus = 'connected',
    contractError?: string,
) {
    expect(isRoomBffSnapshot(view)).toBe(true);
    roomHook.mockReturnValue({
        room: { status: 'ready', connectionStatus, snapshot: view, contractError },
        historySource,
    });
}

describe('Dashboard composition', () => {
    beforeEach(() => {
        roomHook.mockReset();
    });

    it('renders loading and reconnect states and passes no invented snapshot to an overlay', () => {
        const overlay = vi.fn(() => <aside aria-label="Overlay" />);
        roomHook.mockReturnValue({
            room: { status: 'connecting', connectionStatus: 'connecting' },
            historySource,
        });
        const { rerender } = render(<Dashboard renderOverlay={overlay} />);
        expect(
            screen.getByText('Łączenie ze strumieniem pokoju w czasie rzeczywistym…'),
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Włącz' })).toBeNull();
        expect(overlay).toHaveBeenLastCalledWith(undefined);

        roomHook.mockReturnValue({
            room: { status: 'connecting', connectionStatus: 'reconnecting' },
            historySource,
        });
        rerender(<Dashboard renderOverlay={overlay} />);

        expect(
            screen.getByText('Ponowne łączenie ze strumieniem pokoju w czasie rzeczywistym…'),
        ).toBeInTheDocument();
        expect(overlay).toHaveBeenLastCalledWith(undefined);
    });

    it('associates active and terminal commands with their owning LED cards', () => {
        const original = snapshot();
        const view: RenderableRoomSnapshot = {
            ...original,
            devices: original.devices.map((device) =>
                device.deviceId === 'led-second' ? { ...device, activeCommandId: 'cmd-1' } : device,
            ),
        };
        view.activeCommands = [{ ...createPendingCommand(), deviceId: 'led-second' }];
        view.recentCommands = [
            {
                commandId: 'failed-main',
                deviceId: 'led-main',
                commandType: 'set.power',
                status: 'failed',
                requestedState: { power: 'on' },
                requestedAt: '2026-06-08T09:29:00Z',
                failedAt: '2026-06-08T09:29:01Z',
                reason: 'device_rejected',
                message: 'Main device rejected the command.',
                durability: 'durable',
                lifecycleDurability: 'durable',
            },
        ];
        ready(view);

        render(<Dashboard />);

        const main = within(screen.getByTestId('led-main-led-card'));
        const second = within(screen.getByTestId('led-second-led-card'));
        expect(main.getByRole('button', { name: 'Włącz' })).toBeEnabled();
        expect(main.getByText(/Main device rejected the command/)).toBeInTheDocument();
        expect(second.getByRole('button', { name: 'Włącz' })).toBeDisabled();
        expect(second.getByText(/Zażądano: Włączone/)).toBeInTheDocument();
        expect(second.queryByText(/Main device rejected the command/)).toBeNull();
        expect(screen.getByRole('heading', { name: 'Temperatura biurka' })).toBeInTheDocument();
    });

    it('applies device extensions independently and gives the current snapshot to the overlay', () => {
        const view = snapshot();
        ready(view);
        const overlay = vi.fn(() => <aside aria-label="Development overlay" />);

        render(
            <Dashboard
                getDeviceExtension={(device) =>
                    device.deviceId === 'led-main'
                        ? {
                              headerAction: <button>Device scenario</button>,
                              interactionLocked: true,
                          }
                        : undefined
                }
                renderOverlay={overlay}
            />,
        );

        expect(
            within(screen.getByTestId('led-main-led-card')).getByRole('button', { name: 'Włącz' }),
        ).toBeDisabled();
        expect(
            within(screen.getByTestId('led-second-led-card')).getByRole('button', {
                name: 'Włącz',
            }),
        ).toBeEnabled();
        expect(screen.getAllByRole('button', { name: 'Device scenario' })).toHaveLength(1);
        expect(
            screen.getByRole('complementary', { name: 'Development overlay' }),
        ).toBeInTheDocument();
        expect(overlay).toHaveBeenLastCalledWith(view);
    });

    it.each([
        ['reconnecting', undefined],
        ['connected', 'Invalid stream update'],
    ])('keeps controls uncertain after %s or a contract error (%s)', (connection, error) => {
        ready(snapshot(), connection, error);

        render(<Dashboard />);

        expect(screen.getAllByRole('button', { name: 'Włącz' })).toHaveLength(2);
        screen
            .getAllByRole('button', { name: 'Włącz' })
            .forEach((button) => expect(button).toBeDisabled());
        expect(
            screen.getByText(
                'Strumień łączy się ponownie. Wyświetlane są ostatnio znane zdarzenia.',
            ),
        ).toBeInTheDocument();
    });
});
