import {
    acceptedCommandResponseSchema,
    type PendingCommandProjection,
    rejectedCommandResponseSchema,
    type TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import {
    activeCommandProjectionSchema,
    deviceProjectionSchema,
    terminalCommandProjectionSchema,
} from '@smart-room/contracts/projections';
import { isSchema } from '@smart-room/contracts/validation';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LedCard, type LedDeviceProjection } from './LedCard';

const formatTimestamp = vi.hoisted(() => vi.fn(() => 'formatted local timestamp'));
const submitLedPowerCommand = vi.hoisted(() => vi.fn());

vi.mock('../../../features/date-time', () => ({ formatTimestamp }));
vi.mock('../../../api/commands', () => ({ submitLedPowerCommand }));

describe('LedCard', () => {
    it('replaces rejected admission with a retained older result and keeps its labels separate from the latest result', async () => {
        const rejection = {
            commandId: 'cmd-1',
            status: 'rejected',
            reason: 'device_offline',
            message: 'Device is offline.',
            durability: 'volatile',
            lifecycleDurability: 'volatile',
        } as const;
        expect(isSchema(rejectedCommandResponseSchema, rejection)).toBe(true);
        submitLedPowerCommand.mockResolvedValueOnce(rejection);
        const { rerender } = render(<LedCard device={createLed()} />);
        await userEvent.setup().click(screen.getByRole('button', { name: 'Włącz' }));
        expect(screen.getByRole('group', { name: 'Wynik przyjęcia żądania' })).toBeInTheDocument();
        const older: TerminalCommandProjection = {
            commandId: 'cmd-1',
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
            requestedAt: '2026-08-06T11:59:00Z',
            status: 'failed',
            failedAt: '2026-08-06T11:59:01Z',
            reason: rejection.reason,
            message: rejection.message,
            durability: 'volatile',
            lifecycleDurability: 'durable',
        };
        const latest: TerminalCommandProjection = {
            ...createPendingCommand(),
            commandId: 'cmd-newer',
            status: 'confirmed',
            confirmedAt: '2026-08-06T12:00:03Z',
            lifecycleDurability: 'volatile',
        };
        expect(isSchema(terminalCommandProjectionSchema, older)).toBe(true);
        expect(isSchema(terminalCommandProjectionSchema, latest)).toBe(true);
        rerender(<LedCard device={createLed()} recentCommands={[latest, older]} />);
        expect(screen.queryByRole('group', { name: 'Wynik przyjęcia żądania' })).toBeNull();
        const correlated = within(screen.getByRole('group', { name: 'Wynik wysłanego polecenia' }));
        const recent = within(screen.getByRole('group', { name: 'Ostatni wynik polecenia' }));
        expect(correlated.getByText('Zlecenie — dane nieutrwalone')).toBeInTheDocument();
        expect(correlated.queryByText('Status polecenia — dane nieutrwalone')).toBeNull();
        expect(recent.getByText('Status polecenia — dane nieutrwalone')).toBeInTheDocument();
        expect(recent.queryByText('Zlecenie — dane nieutrwalone')).toBeNull();
        expect(screen.getAllByText(/Device is offline/)).toHaveLength(1);
    });

    it('associates mixed durability with each command and separately with stale device evidence', () => {
        const active = { ...createPendingCommand(), lifecycleDurability: 'volatile' as const };
        const recent: TerminalCommandProjection = {
            commandId: 'cmd-previous',
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'off' },
            requestedAt: '2026-08-06T11:59:00Z',
            status: 'failed',
            failedAt: '2026-08-06T11:59:01Z',
            reason: 'volatile_command_lost_on_restart',
            message: 'Previous command was lost on restart.',
            durability: 'volatile',
            lifecycleDurability: 'durable',
        };
        const device: LedDeviceProjection = {
            ...createLed(),
            healthDurability: 'volatile',
            observationStatus: {
                power: {
                    freshness: 'stale',
                    lastObservedAt: '2026-08-06T11:00:00Z',
                    durability: 'volatile',
                },
            },
        };
        expect(isSchema(activeCommandProjectionSchema, active)).toBe(true);
        expect(isSchema(terminalCommandProjectionSchema, recent)).toBe(true);
        expect(isSchema(deviceProjectionSchema, device)).toBe(true);
        render(
            <LedCard
                device={device}
                activeCommand={active}
                recentCommands={[recent]}
                realtimeUncertain
            />,
        );
        const current = within(screen.getByRole('group', { name: 'Bieżące polecenie' }));
        const previous = within(screen.getByRole('group', { name: 'Ostatni wynik polecenia' }));
        expect(current.getByText('Status polecenia — dane nieutrwalone')).toBeInTheDocument();
        expect(current.queryByText('Zlecenie — dane nieutrwalone')).toBeNull();
        expect(previous.getByText('Zlecenie — dane nieutrwalone')).toBeInTheDocument();
        expect(previous.queryByText('Status polecenia — dane nieutrwalone')).toBeNull();
        expect(screen.getByText('Dane zasilania — dane nieutrwalone')).toBeInTheDocument();
        expect(screen.getByText('Stan działania — dane nieutrwalone')).toBeInTheDocument();
        expect(screen.queryByText('Dostępność — dane nieutrwalone')).toBeNull();
        expect(screen.getByLabelText('Potwierdzone zasilanie LED')).toHaveTextContent('Wyłączone');
        expect(screen.getByText(/Obserwacja stanu LED jest nieaktualna/)).toBeInTheDocument();
        expect(screen.queryByText('cmd-previous')).toBeNull();
    });

    it('replaces HTTP admission labels with authoritative SSE evidence without changing observed power', async () => {
        const accepted = {
            commandId: 'cmd-1',
            status: 'accepted',
            durability: 'volatile',
            lifecycleDurability: 'volatile',
        } as const;
        expect(isSchema(acceptedCommandResponseSchema, accepted)).toBe(true);
        submitLedPowerCommand.mockResolvedValueOnce(accepted);
        const { rerender } = render(<LedCard device={createLed()} />);
        await userEvent.setup().click(screen.getByRole('button', { name: 'Włącz' }));
        const admission = screen.getByRole('group', { name: 'Wynik przyjęcia żądania' });
        expect(admission).toHaveTextContent('To wynik przyjęcia, a nie bieżący status wykonania.');
        expect(within(admission).getAllByText(/dane nieutrwalone/)).toHaveLength(2);
        expect(screen.getByLabelText('Potwierdzone zasilanie LED')).toHaveTextContent('Wyłączone');
        const active = {
            ...createPendingCommand(),
            durability: 'volatile' as const,
            lifecycleDurability: 'durable' as const,
        };
        expect(isSchema(activeCommandProjectionSchema, active)).toBe(true);
        rerender(<LedCard device={createLed()} activeCommand={active} />);
        expect(screen.queryByRole('group', { name: 'Wynik przyjęcia żądania' })).toBeNull();
        const current = within(screen.getByRole('group', { name: 'Bieżące polecenie' }));
        expect(current.getByText('Zlecenie — dane nieutrwalone')).toBeInTheDocument();
        expect(current.queryByText('Status polecenia — dane nieutrwalone')).toBeNull();
        rerender(<LedCard device={createLed()} />);
        expect(screen.queryByRole('group')).toBeNull();
    });

    it('keeps reported power confirmed while an on command is pending', () => {
        render(<LedCard device={createLed()} activeCommand={createPendingCommand()} />);

        expect(screen.getByLabelText('Potwierdzone zasilanie LED')).toHaveTextContent(
            'Potwierdzono: Wyłączone',
        );
        expect(
            screen.getByText('Zażądano: Włączone — oczekiwanie na raport urządzenia.'),
        ).toBeInTheDocument();
        expect(screen.getByText('Online')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Włącz' })).toBeDisabled();
        expect(screen.queryByText(/dane nieutrwalone/)).toBeNull();
    });

    it('keeps command progress visible beside degraded and stale warnings', () => {
        render(
            <LedCard
                device={{
                    ...createLed(),
                    health: 'degraded',
                    healthReason: 'partial_data',
                    observationStatus: {
                        power: {
                            freshness: 'stale',
                            lastObservedAt: '2026-08-06T11:00:00Z',
                            durability: 'durable',
                        },
                    },
                }}
                activeCommand={createPendingCommand()}
            />,
        );

        expect(screen.getByText(/partial_data/)).toBeInTheDocument();
        expect(screen.getByText(/Obserwacja stanu LED jest nieaktualna/)).toBeInTheDocument();
        expect(screen.getByText(/Zażądano: Włączone/)).toBeInTheDocument();
    });

    it('renders a bootstrap LED without inventing a confirmed power state', () => {
        const device: LedDeviceProjection = {
            ...createLed(),
            availability: 'unknown',
            availabilityDurability: 'volatile',
            health: 'unknown',
            healthDurability: 'volatile',
            reportedState: {},
            observationStatus: {},
            commandAvailability: { policy: 'block', reason: 'availability_unknown' },
            activeCommandId: undefined,
        };
        expect(isSchema(deviceProjectionSchema, device)).toBe(true);
        render(<LedCard device={device} />);

        expect(screen.getByLabelText('Potwierdzone zasilanie LED')).toHaveTextContent(
            'Potwierdzono: Nieznane',
        );
        expect(screen.getByRole('button', { name: 'Włącz' })).toBeDisabled();
        expect(screen.getByText('Dostępność — dane nieutrwalone')).toBeInTheDocument();
        expect(screen.getByText('Stan działania — dane nieutrwalone')).toBeInTheDocument();
        expect(screen.queryByText('Dane zasilania — dane nieutrwalone')).toBeNull();
    });

    it('keeps an empty alert frame visible when the LED has nothing to report', () => {
        render(<LedCard device={{ ...createLed(), activeCommandId: undefined }} />);

        expect(screen.getByText('Brak bieżących alertów.')).toBeInTheDocument();
    });

    it('renders a supplied neutral header action and locks interaction when requested', () => {
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

it('formats a confirmed command timestamp for the browser before rendering it', () => {
    render(
        <LedCard
            device={createLed()}
            recentCommands={[
                {
                    commandId: 'cmd-1',
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    status: 'confirmed',
                    requestedState: { power: 'on' },
                    requestedAt: '2026-08-06T12:00:00Z',
                    durability: 'durable',
                    lifecycleDurability: 'durable',
                    delivery: {
                        status: 'handed_off',
                        dispatchedAt: '2026-08-06T12:00:01Z',
                        deadlineAt: '2026-08-06T12:00:06Z',
                    },
                    confirmedAt: '2026-08-06T12:00:06Z',
                },
            ]}
        />,
    );

    expect(formatTimestamp).toHaveBeenCalledWith('2026-08-06T12:00:06Z');
    expect(screen.getByText(/formatted local timestamp/)).toBeInTheDocument();
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
