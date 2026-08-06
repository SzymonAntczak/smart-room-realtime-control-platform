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
        expect(screen.getByRole('status')).toHaveTextContent('Pending');
        expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
    });
});

function createLed(): DeviceProjection {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        health: 'online',
        reportedState: { power: 'off' },
        commandAvailability: { policy: 'allow' },
        lastSeenAt: '2026-08-06T12:00:00Z',
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
