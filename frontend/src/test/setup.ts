import '@testing-library/jest-dom/vitest';

import { loadDevelopmentTranslations } from '../app/i18n';

globalThis.ResizeObserver ??= class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
};

if (!HTMLDialogElement.prototype.showModal) {
    const previouslyFocused = new WeakMap<HTMLDialogElement, HTMLElement | null>();

    HTMLDialogElement.prototype.showModal = function showModal() {
        previouslyFocused.set(
            this,
            document.activeElement instanceof HTMLElement ? document.activeElement : null,
        );
        this.setAttribute('open', '');
        this.querySelector<HTMLElement>('[autofocus]')?.focus();
    };

    HTMLDialogElement.prototype.close = function close() {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
        previouslyFocused.get(this)?.focus();
    };
}

await loadDevelopmentTranslations();
