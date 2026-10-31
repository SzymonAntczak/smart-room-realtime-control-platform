import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusTag } from './StatusTag';

describe('StatusTag', () => {
    it('renders its tone and live status semantics', () => {
        render(
            <StatusTag tone="success" testId="availability">
                Online
            </StatusTag>,
        );

        expect(screen.getByTestId('availability')).toHaveAttribute('data-tone', 'success');
        expect(screen.getByRole('status')).toHaveTextContent('Online');
        expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    });
});
