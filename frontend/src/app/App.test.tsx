import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise(() => undefined)),
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders the temperature control surface', () => {
        render(<App />);

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(screen.getByText('Backend snapshot')).toBeInTheDocument();
        expect(screen.getByText('Loading room snapshot...')).toBeInTheDocument();
    });
});
