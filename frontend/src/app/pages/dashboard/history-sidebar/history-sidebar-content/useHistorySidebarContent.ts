import { useCallback, useEffect, useRef, useState } from 'react';

import type { HistoryFeedHandle } from '../../../../features/history';

export function useHistorySidebarContent() {
    const feedRef = useRef<HistoryFeedHandle | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [topTooltip, setTopTooltip] = useState(false);
    const hideTopTooltip = useCallback(() => setTopTooltip(false), []);

    useEffect(() => {
        if (!topTooltip) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                hideTopTooltip();
            }
        };

        const timer = setTimeout(hideTopTooltip, 3000);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [topTooltip, hideTopTooltip]);

    function handleReturnToTop() {
        const result = feedRef.current?.scrollToTop();
        setTopTooltip(result?.alreadyAtTop ?? false);
    }

    return { feedRef, searchOpen, setSearchOpen, topTooltip, hideTopTooltip, handleReturnToTop };
}
