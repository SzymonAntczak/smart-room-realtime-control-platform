import { fireEvent, render, screen } from '@testing-library/react';
import type { FormEvent } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

describe('Button', () => {
    it.each(['text', 'filled', 'outlined'] as const)(
        'renders the %s variant with native props and local classes',
        (variant) => {
            render(
                <Button variant={variant} type="button" aria-pressed="true" className="local-size">
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
        const onClick = vi.fn();

        render(
            <Button variant="outlined" ref={ref} disabled onClick={onClick}>
                Disabled action
            </Button>,
        );

        const button = screen.getByRole('button', { name: 'Disabled action' });

        expect(button).toBeDisabled();
        expect(ref).toHaveBeenCalledWith(button);
        fireEvent.click(button);
        expect(onClick).not.toHaveBeenCalled();
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

    it('preserves native form submission', () => {
        const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
        render(
            <form onSubmit={onSubmit}>
                <Button variant="filled" type="submit">
                    Save
                </Button>
            </form>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('renders a router link with the default outlined variant and an anchor ref', async () => {
        const ref = vi.fn();
        const onClick = vi.fn();
        const router = createMemoryRouter([
            {
                path: '/',
                element: (
                    <Button
                        as="link"
                        to="/details"
                        state={{ focusDashboard: true }}
                        viewTransition
                        ref={ref}
                        onClick={onClick}
                        aria-label="Device details"
                        className="local-link"
                    >
                        Details
                    </Button>
                ),
            },
            { path: '/details', element: <h1>Device</h1> },
        ]);
        render(<RouterProvider router={router} />);
        const link = screen.getByRole('link', { name: 'Device details' });

        expect(link.tagName).toBe('A');
        expect(link).toHaveAttribute('href', '/details');
        expect(link.className).toContain('outlined');
        expect(link).toHaveClass('local-link');
        expect(link).not.toHaveAttribute('as');
        expect(ref).toHaveBeenCalledWith(link);

        fireEvent.click(link);

        expect(await screen.findByRole('heading', { name: 'Device' })).toBeVisible();
        expect(onClick).toHaveBeenCalledOnce();
        expect(router.state.location.state).toEqual({ focusDashboard: true });
    });

    it.each(['text', 'filled', 'outlined'] as const)(
        'renders a link with the explicit %s variant',
        (variant) => {
            const router = createMemoryRouter([
                {
                    path: '/',
                    element: (
                        <Button as="link" to="/details" variant={variant}>
                            Details
                        </Button>
                    ),
                },
            ]);
            render(<RouterProvider router={router} />);

            expect(screen.getByRole('link', { name: 'Details' }).className).toContain(variant);
        },
    );
});
