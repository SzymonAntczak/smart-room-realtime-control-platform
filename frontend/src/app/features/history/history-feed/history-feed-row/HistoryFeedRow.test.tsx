import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HistoryFeedRow } from './HistoryFeedRow';

describe('history virtual row', () => {
    it('adapts the virtual position and reveals the set size only at the end', () => {
        const item = createUserHistoryFixtures().powerChange;
        const props = {
            item,
            'data-index': 14,
            'data-item-index': 14,
            'data-known-size': 192,
            style: { height: 192 },
            context: { devices: [], endReached: false, totalItems: 50 },
        };
        const { rerender } = render(
            <ol>
                <HistoryFeedRow {...props} />
            </ol>,
        );
        const row = screen.getByRole('listitem');
        expect(row).toHaveAttribute('aria-posinset', '15');
        expect(row).toHaveAttribute('aria-setsize', '-1');
        expect(row).toHaveStyle({ height: '192px' });

        rerender(
            <ol>
                <HistoryFeedRow {...props} context={{ ...props.context, endReached: true }} />
            </ol>,
        );
        expect(row).toHaveAttribute('aria-setsize', '50');
    });
});
