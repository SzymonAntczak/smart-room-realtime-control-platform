import '@testing-library/jest-dom/vitest';

import { loadDevelopmentTranslations } from '../app/i18n';

globalThis.ResizeObserver ??= class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
};

await loadDevelopmentTranslations();
