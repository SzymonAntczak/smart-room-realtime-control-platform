import {
    type PendingCommandProjection,
    rejectedCommandResponseSchema,
    type TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import {
    deviceProjectionSchema,
    terminalCommandProjectionSchema,
} from '@smart-room/contracts/projections';
import { isSchema } from '@smart-room/contracts/validation';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LedCard, type LedDeviceProjection } from './LedCard';

const submitLedPowerCommand = vi.hoisted(() => vi.fn());

vi.mock('../../../api/commands', () => ({ submitLedPowerCommand }));

describe('LedCard', () => {
    it('shows the reported state in one accessible control and keeps the empty alert', () => {
        render(<LedCard device={createLed()} />);

        const button = screen.getByRole('button', { name: 'Włącz' });
        expect(button).toHaveTextContent('Wyłączone');
        expect(button).toHaveAttribute('aria-pressed', 'false');
        expect(button).toHaveAttribute('aria-busy', 'false');
        expect(button.querySelector('svg')).toHaveClass('lucide-lightbulb-off');
        expect(screen.getByTestId('led-main-command-status')).toHaveTextContent(
            'Brak bieżących alertów.',
        );
        expect(screen.queryByText(/Potwierdzono:/)).toBeNull();
        expect(screen.queryByRole('group', { name: /polecenie/i })).toBeNull();
    });

    it('shows loading while an accepted command waits for its device report', () => {
        render(<LedCard device={createLed()} activeCommand={createPendingCommand()} />);

        const button = screen.getByRole('button', { name: 'Włącz' });
        expect(button).toHaveTextContent('Wyłączone');
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByTestId('led-main-command-status')).toHaveTextContent(
            'Zażądano: Włączone — oczekiwanie na raport urządzenia.',
        );
    });

    it('shows success only with the reported state after confirmation', () => {
        const confirmed: TerminalCommandProjection = {
            ...createPendingCommand(),
            status: 'confirmed',
            confirmedAt: '2026-08-06T12:00:03Z',
        };
        expect(isSchema(terminalCommandProjectionSchema, confirmed)).toBe(true);
        render(
            <LedCard
                device={{ ...createLed(), reportedState: { power: 'on' } }}
                recentCommands={[confirmed]}
            />,
        );

        const button = screen.getByRole('button', { name: 'Wyłącz' });
        expect(button).toHaveTextContent('Włączone');
        expect(button).toHaveAttribute('aria-pressed', 'true');
        expect(button.querySelector('svg')).toHaveClass('lucide-lightbulb');
        expect(screen.getByTestId('led-main-command-status')).toHaveTextContent(
            'Polecenie potwierdzone o',
        );
        expect(screen.getByTestId('led-main-command-status')).toHaveAttribute(
            'data-variant',
            'info',
        );
    });

    it('restores the established rejection message from the response', async () => {
        const rejection = {
            commandId: 'cmd-1',
            status: 'rejected',
            reason: 'device_offline',
            message: 'Device is offline.',
            durability: 'durable',
            lifecycleDurability: 'durable',
        } as const;
        expect(isSchema(rejectedCommandResponseSchema, rejection)).toBe(true);
        submitLedPowerCommand.mockResolvedValueOnce(rejection);
        render(<LedCard device={createLed()} />);

        await userEvent.setup().click(screen.getByRole('button', { name: 'Włącz' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Device is offline.');
        expect(screen.getByRole('button', { name: 'Włącz' })).toHaveTextContent('Wyłączone');
    });

    it('preserves the timeout outcome when a late report changes the displayed state', () => {
        const timedOut: TerminalCommandProjection = {
            ...createPendingCommand(),
            status: 'timed_out',
            timedOutAt: '2026-08-06T12:00:06Z',
            reason: 'confirmation_not_received',
        };
        expect(isSchema(terminalCommandProjectionSchema, timedOut)).toBe(true);
        const device: LedDeviceProjection = { ...createLed(), reportedState: { power: 'on' } };
        expect(isSchema(deviceProjectionSchema, device)).toBe(true);
        render(<LedCard device={device} recentCommands={[timedOut]} />);

        expect(screen.getByRole('button', { name: 'Wyłącz' })).toHaveTextContent('Włączone');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Upłynął limit czasu polecenia: confirmation_not_received.',
        );
    });

    it('shows an unknown reported state without enabling the control', () => {
        const device: LedDeviceProjection = {
            ...createLed(),
            availability: 'unknown',
            health: 'unknown',
            reportedState: {},
            observationStatus: {},
            commandAvailability: { policy: 'block', reason: 'availability_unknown' },
            activeCommandId: undefined,
        };
        expect(isSchema(deviceProjectionSchema, device)).toBe(true);
        render(<LedCard device={device} />);

        const button = screen.getByRole('button', { name: 'Włącz' });
        expect(button).toHaveTextContent('Nieznane');
        expect(button).toBeDisabled();
        expect(button).not.toHaveAttribute('aria-pressed');
        expect(screen.getByTestId('led-main-command-status')).toHaveTextContent(
            'Brak bieżących alertów.',
        );
    });

    it('keeps the established stale, connection and requested-state alerts', () => {
        const pending: PendingCommandProjection = {
            ...createPendingCommand(),
            durability: 'volatile',
            lifecycleDurability: 'volatile',
        };
        const device: LedDeviceProjection = {
            ...createLed(),
            observationStatus: {
                power: {
                    freshness: 'stale',
                    lastObservedAt: '2026-08-06T11:00:00Z',
                    durability: 'volatile',
                },
            },
        };
        render(<LedCard device={device} activeCommand={pending} realtimeUncertain />);

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Zażądano: Włączone — oczekiwanie na raport urządzenia.');
        expect(alert).toHaveTextContent('Strumień czasu rzeczywistego ponownie się łączy.');
        expect(alert).toHaveTextContent('Obserwacja stanu LED jest nieaktualna');
        expect(alert).not.toHaveTextContent('trwale zapisane');
    });

    it('renders a supplied header action and honors an interaction lock', () => {
        render(
            <LedCard
                device={createLed()}
                headerAction={<button type="button">Extra action</button>}
                interactionLocked
            />,
        );

        expect(screen.getByRole('button', { name: 'Extra action' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Włącz' })).toBeDisabled();
    });
});

function createLed(): LedDeviceProjection {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        availability: 'online',
        availabilityChangedAt: '2026-08-06T12:00:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-08-06T12:00:00Z',
        healthDurability: 'durable',
        reportedState: { power: 'off' },
        commandAvailability: { policy: 'allow' },
        observationStatus: {
            power: {
                freshness: 'unknown',
                lastObservedAt: '2026-08-06T12:00:00Z',
                durability: 'durable',
            },
        },
        activeCommandId: 'cmd-1',
    };
}

function createPendingCommand(): PendingCommandProjection {
    return {
        commandId: 'cmd-1',
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'pending',
        requestedState: { power: 'on' },
        requestedAt: '2026-08-06T12:00:00Z',
        delivery: {
            status: 'handed_off',
            dispatchedAt: '2026-08-06T12:00:01Z',
            deadlineAt: '2026-08-06T12:00:06Z',
        },
        durability: 'durable',
        lifecycleDurability: 'durable',
    };
}
