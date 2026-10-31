import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { i18n } from '../../i18n';

import { PageNotFound } from './PageNotFound';
it('identifies an unknown page and links back to the dashboard', () => {
    render(<PageNotFound />);
    expect(
        screen.getByRole('heading', { name: i18n.t('pageNotFound', { ns: 'deviceDetails' }) }),
    ).toBeInTheDocument();
    expect(
        screen.getByRole('link', { name: i18n.t('back', { ns: 'deviceDetails' }) }),
    ).toHaveAttribute('href', '/');
});
