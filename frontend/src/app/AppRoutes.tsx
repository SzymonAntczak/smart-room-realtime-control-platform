import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';

import { PageNotFound } from './PageNotFound';
import { Dashboard } from './pages/dashboard/Dashboard';
import { DeviceDetails } from './pages/device-details/DeviceDetails';

export function createAppRoutes(dashboard?: ReactNode): RouteObject[] {
    return [
        { path: '/', element: dashboard ?? <Dashboard /> },
        { path: '/device-details/:deviceId', element: <DeviceDetails /> },
        { path: '*', element: <PageNotFound /> },
    ];
}
