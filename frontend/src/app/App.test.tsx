import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
    it('renders the temperature control surface', () => {
        render(<App />);

        expect(screen.getByRole('heading', { name: 'Desk Temperature' })).toBeInTheDocument();
        expect(screen.getByText('Simulated realtime')).toBeInTheDocument();
        expect(screen.getByLabelText('Current temperature')).toHaveTextContent('22.1');
    });
});
