import './globals.css';
import './i18n';

import { type ComponentType, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';

async function bootstrap(): Promise<void> {
    let Root: ComponentType = App;

    if (import.meta.env.DEV) {
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
