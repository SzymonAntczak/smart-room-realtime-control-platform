import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { i18n } from '../../../i18n';

import { VolatileEvidence } from './VolatileEvidence';

describe('VolatileEvidence', () => {
    it('names only volatile dimensions in a mixed set', () => {
        render(
            <VolatileEvidence
                dimensions={[
                    { label: 'Availability dimension', durability: 'durable' },
                    { label: 'Health dimension', durability: 'volatile' },
                ]}
            />,
        );
        expect(screen.getByRole('listitem')).toHaveTextContent(
            i18n.t('durability.volatileDimension', {
                ns: 'dashboard',
                dimension: 'Health dimension',
            }),
        );
        expect(
            screen.queryByText(
                i18n.t('durability.volatileDimension', {
                    ns: 'dashboard',
                    dimension: 'Availability dimension',
                }),
            ),
        ).toBeNull();
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
