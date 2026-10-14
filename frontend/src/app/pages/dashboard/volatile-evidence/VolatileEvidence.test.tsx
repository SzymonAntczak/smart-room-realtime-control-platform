import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VolatileEvidence } from './VolatileEvidence';

describe('VolatileEvidence', () => {
    it('names only volatile dimensions in a mixed set', () => {
        render(
            <VolatileEvidence
                dimensions={[
                    { label: 'Dostępność', durability: 'durable' },
                    { label: 'Stan działania', durability: 'volatile' },
                ]}
            />,
        );
        expect(screen.getByRole('listitem')).toHaveTextContent(
            'Stan działania — dane nieutrwalone',
        );
        expect(screen.queryByText(/Dostępność/)).toBeNull();
    });

    it('renders no empty list when every dimension is durable or absent', () => {
        const { rerender } = render(
            <VolatileEvidence dimensions={[{ label: 'Zlecenie', durability: 'durable' }]} />,
        );
        expect(screen.queryByRole('list')).toBeNull();
        rerender(<VolatileEvidence dimensions={[]} />);
        expect(screen.queryByRole('list')).toBeNull();
    });
});
