import type { ActiveCommandProjection } from '@smart-room/contracts/commands';
import type { DeviceProjection } from '@smart-room/contracts/projections';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LedControl } from './LedControl';

describe('LedControl', () => {
    it('keeps reported power confirmed while an on command is pending', () => {
        render(<LedControl device={createLed()} activeCommand={createPendingCommand()} />);

        expect(screen.getByLabelText('Confirmed LED power')).toHaveTextContent('Confirmed: Off');
        expect(screen.getByText('Requested: On — awaiting device report.')).toBeInTheDocument();
        expect(screen.getByText('Online')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
    });

    it('keeps command progress visible beside degraded and stale warnings', () => {
        render(
            <LedControl
                device={{
                    ...createLed(),
                    health: 'degraded',
                    healthReason: 'partial_data',
                    observationStatus: {
                        power: { freshness: 'stale', lastObservedAt: '2026-08-06T11:00:00Z' },
                    },
                }}
                activeCommand={createPendingCommand()}
            />,
        );

        expect(screen.getByText(/partial_data/)).toBeInTheDocument();
        expect(screen.getByText(/LED state observation is stale/)).toBeInTheDocument();
        expect(screen.getByText(/Requested: On/)).toBeInTheDocument();
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

        expect(screen.getByLabelText('Confirmed LED power')).toHaveTextContent(
            'Confirmed: Unknown',
        );
        expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
    });

    it('keeps an empty alert frame visible when the LED has nothing to report', () => {
        render(<LedControl device={{ ...createLed(), activeCommandId: undefined }} />);

        expect(screen.getByText('No current alerts.')).toBeInTheDocument();
    });

    it('renders the dev-only scenario control only when enabled', () => {
        const { rerender } = render(<LedControl device={createLed()} />);

        expect(screen.queryByRole('button', { name: 'Dev scenarios' })).not.toBeInTheDocument();

        rerender(<LedControl device={createLed()} showDevScenarioPanel />);

        expect(screen.getByRole('button', { name: 'Dev scenarios' })).toBeInTheDocument();
    });
});

function createLed(): DeviceProjection {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        availability: 'online',
        availabilityChangedAt: '2026-08-06T12:00:00Z',
        health: 'healthy',
        healthChangedAt: '2026-08-06T12:00:00Z',
        reportedState: { power: 'off' },
        commandAvailability: { policy: 'allow' },
        observationStatus: {
            power: { freshness: 'unknown', lastObservedAt: '2026-08-06T12:00:00Z' },
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
    };
}
