import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Tag } from './Tag';

describe('Tag', () => {
    it('renders a neutral label without status announcements by default', () => {
        render(
            <Tag testId="label" className="local-label" title="Category" icon={<span>Icon</span>}>
                Sensor
            </Tag>,
        );

        const tag = screen.getByTestId('label');

        expect(tag).toHaveAttribute('data-tone', 'neutral');
        expect(tag).not.toHaveAttribute('role');
        expect(tag).not.toHaveAttribute('aria-live');
        expect(tag).toHaveClass('local-label');
        expect(tag).toHaveAttribute('title', 'Category');
        expect(tag).toHaveTextContent('IconSensor');
    });

    it('renders its tone and live status semantics', () => {
        render(
            <Tag tone="success" testId="availability" role="status" aria-live="polite">
                Online
            </Tag>,
        );

        expect(screen.getByTestId('availability')).toHaveAttribute('data-tone', 'success');
        expect(screen.getByRole('status')).toHaveTextContent('Online');
        expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    });
});
