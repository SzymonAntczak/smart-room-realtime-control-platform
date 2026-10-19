import './globals.css';

import { type ComponentType, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { createAppRoutes } from './app/AppRoutes';
import { i18nReady, loadDevelopmentTranslations } from './app/i18n';

async function bootstrap(): Promise<void> {
    await i18nReady;

    let DevelopmentDashboard: ComponentType | undefined;

    if (import.meta.env.DEV) {
        await loadDevelopmentTranslations();
        const { AppDev } = await import('./app/dev/AppDev');

        DevelopmentDashboard = AppDev;
    }

    const router = createBrowserRouter(
        createAppRoutes(DevelopmentDashboard ? <DevelopmentDashboard /> : undefined),
    );

    createRoot(document.getElementById('root') as HTMLElement).render(
        <StrictMode>
            <RouterProvider router={router} />
        </StrictMode>,
    );
}

void bootstrap();
