import type { ActiveCommandProjection } from '@smart-room/contracts/commands';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LedDeviceProjection } from '../../shared/room-rendering';

import { LedControl } from './LedControl';

const formatTimestamp = vi.hoisted(() => vi.fn(() => 'formatted local timestamp'));

vi.mock('../../../i18n/time', () => ({ formatTimestamp }));

describe('LedControl', () => {
    it('keeps reported power confirmed while an on command is pending', () => {
        render(<LedControl device={createLed()} activeCommand={createPendingCommand()} />);

        expect(screen.getByLabelText('Potwierdzone zasilanie LED')).toHaveTextContent(
            'Potwierdzono: Wyłączone',
        );
        expect(
            screen.getByText('Zażądano: Włączone — oczekiwanie na raport urządzenia.'),
        ).toBeInTheDocument();
        expect(screen.getByText('Online')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Włącz' })).toBeDisabled();
    });

    it('keeps command progress visible beside degraded and stale warnings', () => {
        render(
            <LedControl
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
        render(
            <LedControl
                device={{
                    ...createLed(),
                    availability: 'unknown',
                    health: 'unknown',
                    reportedState: {},
                    observationStatus: {},
                    commandAvailability: { policy: 'block', reason: 'availability_unknown' },
                    activeCommandId: undefined,
                }}
            />,
        );

        expect(screen.getByLabelText('Potwierdzone zasilanie LED')).toHaveTextContent(
            'Potwierdzono: Nieznane',
        );
        expect(screen.getByRole('button', { name: 'Włącz' })).toBeDisabled();
    });

    it('keeps an empty alert frame visible when the LED has nothing to report', () => {
        render(<LedControl device={{ ...createLed(), activeCommandId: undefined }} />);

        expect(screen.getByText('Brak bieżących alertów.')).toBeInTheDocument();
    });

    it('renders a supplied neutral header action and locks interaction when requested', () => {
        render(
            <LedControl
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
        <LedControl
            device={createLed()}
            recentCommand={{
                commandId: 'cmd-1',
                deviceId: 'led-main',
                commandType: 'set.power',
                status: 'confirmed',
                requestedState: { power: 'on' },
                requestedAt: '2026-08-06T12:00:00Z',
                durability: 'durable',
                lifecycleDurability: 'durable',
                dispatchedAt: '2026-08-06T12:00:01Z',
                confirmedAt: '2026-08-06T12:00:06Z',
            }}
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

function createPendingCommand(): ActiveCommandProjection {
    return {
        commandId: 'cmd-1',
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'pending',
        requestedState: { power: 'on' },
        requestedAt: '2026-08-06T12:00:00Z',
        dispatchedAt: '2026-08-06T12:00:01Z',
        deadlineAt: '2026-08-06T12:00:06Z',
        durability: 'durable',
        lifecycleDurability: 'durable',
    };
}
