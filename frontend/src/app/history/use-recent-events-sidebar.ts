import { useEffect, useState } from 'react';

const narrowViewportQuery = '(max-width: 48rem)';

function isNarrowViewport(): boolean {
    return (
        typeof window.matchMedia === 'function' && window.matchMedia(narrowViewportQuery).matches
    );
}

export function useRecentEventsSidebar() {
    const [narrowViewport, setNarrowViewport] = useState(isNarrowViewport);
    const [manualChoice, setManualChoice] = useState<boolean>();

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') {
            return;
        }

        const media = window.matchMedia(narrowViewportQuery);
        const onChange = (event: MediaQueryListEvent) => setNarrowViewport(event.matches);

        setNarrowViewport(media.matches);
        media.addEventListener('change', onChange);

        return () => media.removeEventListener('change', onChange);
    }, []);

    const isOpen = manualChoice ?? !narrowViewport;

    return {
        isOpen,
        toggle() {
            setManualChoice(!isOpen);
        },
    };
}
