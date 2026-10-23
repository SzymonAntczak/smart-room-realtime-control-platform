import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { i18n } from '../i18n';

import { RouteLoading } from './RouteLoading';

function pendingImport() {
    let resolve: () => void = () => {
        throw new Error('Import resolver is not initialized.');
    };

    const promise = new Promise<void>((complete) => {
        resolve = complete;
    });

    return { promise, resolve };
}

describe('RouteLoading', () => {
    it('describes an initial pending import and disappears when the route is ready', async () => {
        const pending = pendingImport();
        const router = createMemoryRouter([
            {
                path: '/',
                hydrateFallbackElement: <RouteLoading initial />,
                lazy: async () => {
                    await pending.promise;

                    return { Component: () => <main>Ready</main> };
                },
            },
        ]);
        render(<RouterProvider router={router} />);
        expect(screen.getByRole('status')).toHaveTextContent(
            i18n.t('route.loading', { ns: 'common' }),
        );
        await act(async () => pending.resolve());
        expect(await screen.findByRole('main')).toHaveTextContent('Ready');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('keeps the current page visible during a pending navigation', async () => {
        const pending = pendingImport();
        const router = createMemoryRouter([
            {
                element: (
                    <>
                        <RouteLoading />
                        <Outlet />
                    </>
                ),
                children: [
                    {
                        path: '/',
                        element: (
                            <main>
                                <Link to="/next">Next</Link>
                            </main>
                        ),
                    },
                    {
                        path: '/next',
                        lazy: async () => {
                            await pending.promise;

                            return { Component: () => <main>Next page</main> };
                        },
                    },
                ],
            },
        ]);
        render(<RouterProvider router={router} />);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        await userEvent.setup().click(screen.getByRole('link', { name: 'Next' }));
        expect(screen.getByRole('status')).toHaveTextContent(
            i18n.t('route.loading', { ns: 'common' }),
        );
        expect(screen.getByRole('main')).toHaveTextContent('Next');
        await act(async () => pending.resolve());
        expect(await screen.findByRole('main')).toHaveTextContent('Next page');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
