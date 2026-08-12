import './globals.css';

import { type ComponentType, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { i18nReady, loadDevelopmentTranslations } from './i18n';

async function bootstrap(): Promise<void> {
    await i18nReady;

    let Root: ComponentType = App;

    if (import.meta.env.DEV) {
        await loadDevelopmentTranslations();
        const { AppDev } = await import('./app/dev/AppDev');

        Root = AppDev;
    }

    createRoot(document.getElementById('root') as HTMLElement).render(
        <StrictMode>
            <Root />
        </StrictMode>,
    );
}

void bootstrap();
