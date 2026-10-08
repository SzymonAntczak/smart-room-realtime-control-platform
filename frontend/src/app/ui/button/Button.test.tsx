import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

describe('Button', () => {
    it.each(['text', 'filled', 'outlined'] as const)(
        'renders the %s variant with native props and local classes',
        (variant) => {
            render(
                <Button
                    variant={variant}
                    type="button"
                    aria-pressed="true"
                    className="local-size"
                >
                    Action
                </Button>,
            );

            const button = screen.getByRole('button', { name: 'Action' });

            expect(button).toHaveAttribute('type', 'button');
            expect(button).toHaveAttribute('aria-pressed', 'true');
            expect(button.className).toContain(variant);
            expect(button).toHaveClass('local-size');
        },
    );

    it('forwards refs and disabled state', () => {
        const ref = vi.fn();

        render(
            <Button variant="outlined" ref={ref} disabled>
                Disabled action
            </Button>,
        );

        const button = screen.getByRole('button', { name: 'Disabled action' });

        expect(button).toBeDisabled();
        expect(ref).toHaveBeenCalledWith(button);
    });

    it('calls the native click handler', () => {
        const onClick = vi.fn();

        render(
            <Button variant="text" onClick={onClick}>
                Action
            </Button>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Action' }));

        expect(onClick).toHaveBeenCalledOnce();
    });
});
