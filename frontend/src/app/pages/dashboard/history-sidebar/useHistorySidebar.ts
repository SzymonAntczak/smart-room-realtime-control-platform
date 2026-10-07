import { useState, useSyncExternalStore } from 'react';

const narrowViewportQuery = '(max-width: 48rem)';

function isNarrowViewport(): boolean {
    return (
        typeof window.matchMedia === 'function' && window.matchMedia(narrowViewportQuery).matches
    );
}

function subscribeToViewport(onChange: () => void) {
    if (typeof window.matchMedia !== 'function') {
        return () => undefined;
    }

    const media = window.matchMedia(narrowViewportQuery);
    media.addEventListener('change', onChange);

    return () => media.removeEventListener('change', onChange);
}

export function useHistorySidebar() {
    const narrowViewport = useSyncExternalStore(subscribeToViewport, isNarrowViewport, () => false);
    const [manualChoice, setManualChoice] = useState<boolean>();

    const isOpen = manualChoice ?? !narrowViewport;

    return {
        isOpen,
        toggle() {
            setManualChoice(!isOpen);
        },
    };
}
