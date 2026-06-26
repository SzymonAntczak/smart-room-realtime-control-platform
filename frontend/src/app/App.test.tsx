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

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(screen.getByText('Realtime room stream')).toBeInTheDocument();
        expect(screen.getByText('Connecting to realtime room stream...')).toBeInTheDocument();
    });
});

class MockWebSocket extends EventTarget {
    close(): void {
        this.dispatchEvent(new Event('close'));
    }
}
