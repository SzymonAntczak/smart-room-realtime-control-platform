import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { InfiniteListContainer } from './InfiniteListContainer';

describe('history virtual list', () => {
    it('keeps ordered-list semantics and forwards the measured style and ref', () => {
        const ref = createRef<HTMLUListElement>();
        render(
            <InfiniteListContainer
                ref={ref}
                style={{ paddingTop: 192 }}
                data-testid="measured-list"
            >
                <li>Entry</li>
            </InfiniteListContainer>,
        );

        const list = screen.getByRole('list');
        expect(list.tagName).toBe('OL');
        expect(list).toHaveStyle({ paddingTop: '192px' });
        expect(ref.current).toBe(list);
        expect(screen.getByRole('listitem')).toHaveTextContent('Entry');
    });
});
