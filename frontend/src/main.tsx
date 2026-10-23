import './globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { createAppRoutes } from './app/AppRoutes';
import { i18nReady, loadDevelopmentTranslations } from './app/i18n';

async function bootstrap(): Promise<void> {
    await i18nReady;

    let loadDashboard: Parameters<typeof createAppRoutes>[0];

    if (import.meta.env.DEV) {
        await loadDevelopmentTranslations();
        loadDashboard = async () => ({ Component: (await import('./app/dev/AppDev')).AppDev });
    }

    const router = createBrowserRouter(createAppRoutes(loadDashboard));

    createRoot(document.getElementById('root') as HTMLElement).render(
        <StrictMode>
            <RouterProvider router={router} />
        </StrictMode>,
    );
}

void bootstrap();
