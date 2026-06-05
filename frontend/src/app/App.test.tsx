import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { createFixtureRealtimeClient } from './room-realtime/fixture-realtime-client';

function renderApp() {
    render(<App client={createFixtureRealtimeClient()} />);
}

describe('App', () => {
    it('renders the main dashboard from fixture data', () => {
        renderApp();

        expect(screen.getByRole('heading', { name: 'Local Smart Room' })).toBeInTheDocument();
        expect(screen.getByLabelText('Connection status')).toHaveTextContent('Fixture data');
        expect(screen.getByRole('heading', { name: 'Recent events' })).toBeInTheDocument();
    });

    it('keeps requested power separate from reported power', () => {
        renderApp();

        expect(screen.getByText('Reported power').nextElementSibling).toHaveTextContent('off');
        expect(screen.getByText('Requested power').nextElementSibling).toHaveTextContent('on');
        expect(screen.getByText('pending')).toBeInTheDocument();
    });

    it('blocks another LED command while one is pending', () => {
        renderApp();

        expect(screen.getByRole('button', { name: 'Request On' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Request Off' })).toBeDisabled();
        expect(
            screen.getByText('Another command is already active for this device.'),
        ).toBeInTheDocument();
    });

    it('shows stale and offline device health labels', () => {
        renderApp();

        expect(screen.getByText('stale')).toBeInTheDocument();
        expect(screen.getByText('offline')).toBeInTheDocument();
    });

    it('renders platform event feed entries from fixture state', () => {
        renderApp();

        expect(screen.getByText('command.requested')).toBeInTheDocument();
        expect(screen.getByText('command.dispatched')).toBeInTheDocument();
        expect(screen.getByText('device.state.reported')).toBeInTheDocument();
        expect(screen.getByText('simulator-adapter')).toBeInTheDocument();
    });
});
