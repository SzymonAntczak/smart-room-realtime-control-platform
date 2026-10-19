import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EventHistoryContext } from '../event-history-context';

import { HistoryRow } from './HistoryRow';

const context: EventHistoryContext = {
    deviceName: 'Desk LED',
    endReached: true,
    totalItems: 4,
    scrollLabel: 'Device event history',
    endMessage: null,
};

describe('history virtual row', () => {
    it('presents the selected device name and virtual list position', () => {
        render(
            <ol>
                <HistoryRow
                    item={createUserHistoryFixtures().powerChange}
                    data-index={2}
                    data-item-index={2}
                    data-known-size={192}
                    style={{ height: 192 }}
                    context={context}
                />
            </ol>,
        );

        const row = screen.getByRole('listitem');
        expect(row).toHaveTextContent('Desk LED');
        expect(row).toHaveAttribute('aria-posinset', '3');
        expect(row).toHaveAttribute('aria-setsize', '4');
    });
});
