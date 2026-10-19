import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { HistoryFeedList } from './HistoryFeedList';

describe('history virtual list', () => {
    it('keeps ordered-list semantics and forwards the measured style and ref', () => {
        const ref = createRef<HTMLUListElement>();
        render(
            <HistoryFeedList ref={ref} style={{ paddingTop: 192 }} data-testid="measured-list">
                <li>Entry</li>
            </HistoryFeedList>,
        );

        const list = screen.getByRole('list');
        expect(list.tagName).toBe('OL');
        expect(list).toHaveStyle({ paddingTop: '192px' });
        expect(ref.current).toBe(list);
        expect(screen.getByRole('listitem')).toHaveTextContent('Entry');
    });
});
