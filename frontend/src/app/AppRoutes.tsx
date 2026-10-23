import type { ComponentType } from 'react';
import { Outlet, type RouteObject } from 'react-router';

import { RoomProvider } from './features/room';
import { PageNotFound } from './PageNotFound';
import { RouteError } from './route-error/RouteError';
import { RouteLoading } from './route-loading/RouteLoading';

export function createAppRoutes(
    loadDashboard: () => Promise<{ Component: ComponentType }> = async () => ({
        Component: (await import('./pages/dashboard/Dashboard')).Dashboard,
    }),
): RouteObject[] {
    return [
        {
            element: (
                <RoomProvider>
                    <RouteLoading />
                    <Outlet />
                </RoomProvider>
            ),
            hydrateFallbackElement: <RouteLoading initial />,
            ErrorBoundary: RouteError,
            children: [
                {
                    path: '/',
                    lazy: loadDashboard,
                },
                {
                    path: '/device-details/:deviceId',
                    lazy: async () => ({
                        Component: (await import('./pages/device-details/DeviceDetails'))
                            .DeviceDetails,
                    }),
                },
            ],
        },
        { path: '*', element: <PageNotFound /> },
    ];
}
