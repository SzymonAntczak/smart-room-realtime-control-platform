import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

describe('App', () => {
    beforeEach(() => {
        vi.stubGlobal('WebSocket', MockWebSocket);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders the temperature control surface', () => {
        render(<App />);

        expect(
            screen.getByRole('heading', { name: 'Desk Temperature', level: 2 }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
        expect(screen.getAllByText('No current alerts.')).toHaveLength(2);
        expect(screen.getByText('Connecting to realtime room stream...')).toBeInTheDocument();
    });

    it('does not render development scenario controls outside the development build', () => {
        render(<App showDevScenarioPanel={false} />);

        expect(
            screen.queryByRole('heading', { name: 'Temperature scenarios' }),
        ).not.toBeInTheDocument();
    });
});

class MockWebSocket extends EventTarget {
    close(): void {
        this.dispatchEvent(new Event('close'));
    }
}
