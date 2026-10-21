import type { ReactNode } from 'react';
import { Outlet, type RouteObject } from 'react-router';

import { RoomProvider } from './features/room';
import { PageNotFound } from './PageNotFound';
import { Dashboard } from './pages/dashboard/Dashboard';
import { DeviceDetails } from './pages/device-details/DeviceDetails';

export function createAppRoutes(dashboard?: ReactNode): RouteObject[] {
    return [
        {
            element: (
                <RoomProvider>
                    <Outlet />
                </RoomProvider>
            ),
            children: [
                { path: '/', element: dashboard ?? <Dashboard /> },
                { path: '/device-details/:deviceId', element: <DeviceDetails /> },
            ],
        },
        { path: '*', element: <PageNotFound /> },
    ];
}
