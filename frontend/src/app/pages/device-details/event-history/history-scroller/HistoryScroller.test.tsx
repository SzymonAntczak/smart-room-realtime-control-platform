import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EventHistoryContext } from '../event-history-context';

import { HistoryScroller } from './HistoryScroller';

const context: EventHistoryContext = {
    deviceName: 'Desk LED',
    endReached: true,
    totalItems: 4,
    scrollLabel: 'Device event history',
    endMessage: 'End of retained entries',
};

describe('history scroller', () => {
    it('keeps the end status inside the named scroll region', () => {
        render(
            <HistoryScroller context={context} style={{ height: 600 }}>
                <ol>
                    <li>Most recent event</li>
                </ol>
            </HistoryScroller>,
        );

        const scrollRegion = screen.getByRole('region', { name: 'Device event history' });
        expect(within(scrollRegion).getByRole('status')).toHaveTextContent(
            'End of retained entries',
        );
        expect(within(scrollRegion).getByRole('listitem')).toHaveTextContent('Most recent event');
    });
});
