import '@testing-library/jest-dom/vitest';

import { loadDevelopmentTranslations } from '../app/i18n';

// jsdom has no layout. Only the chart's measured container needs a fixed size;
// preserve native jsdom measurements for scrolling, dialogs and other tests.
const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains('recharts-responsive-container')
        ? DOMRect.fromRect({ width: 740, height: 288 })
        : getBoundingClientRect.call(this);
};

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
