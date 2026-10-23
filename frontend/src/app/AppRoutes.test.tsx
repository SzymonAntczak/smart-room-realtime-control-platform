import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MockEventSource } from '../test/room/mock-event-source';

import { createAppRoutes } from './AppRoutes';
import { i18n } from './i18n';

describe('application route imports', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('defers both page modules and keeps the room layout outside their loading boundaries', () => {
        const [room] = createAppRoutes();
        expect(room.element).toBeDefined();
        expect(room.hydrateFallbackElement).toBeDefined();
        expect(room.ErrorBoundary).toBeDefined();
        expect(room.children?.map((route) => route.path)).toEqual([
            '/',
            '/device-details/:deviceId',
        ]);

        for (const route of room.children ?? []) {
            expect(route.element).toBeUndefined();
            expect(route.lazy).toBeTypeOf('function');
        }
    });

    it('waits for the initial page module before starting the shared room connection', async () => {
        MockEventSource.instances.length = 0;
        vi.stubGlobal('EventSource', MockEventSource);

        let release: () => void = () => {
            throw new Error('Import gate is not initialized.');
        };

        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const router = createMemoryRouter(
            createAppRoutes(async () => {
                await pending;

                return { Component: () => <main>Ready</main> };
            }),
        );
        render(
            <StrictMode>
                <RouterProvider router={router} />
            </StrictMode>,
        );
        expect(screen.getByRole('status')).toHaveTextContent(
            i18n.t('route.loading', { ns: 'common' }),
        );
        expect(MockEventSource.instances).toHaveLength(0);
        await act(async () => release());
        expect(await screen.findByRole('main')).toHaveTextContent('Ready');
        expect(MockEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);
    });

    it('renders the localized reload action when the initial page import fails', async () => {
        vi.stubGlobal('EventSource', MockEventSource);
        const router = createMemoryRouter(
            createAppRoutes(async () => {
                throw new Error('Import unavailable');
            }),
        );
        render(<RouterProvider router={router} />);
        expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
            i18n.t('route.failed', { ns: 'common' }),
        );
        expect(screen.getByRole('link')).toHaveAttribute('href', window.location.href);
    });
});
