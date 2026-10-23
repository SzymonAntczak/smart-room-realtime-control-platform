import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { i18n } from '../i18n';

import { RouteError } from './RouteError';

describe('RouteError', () => {
    it('explains the failed page load and offers a native full-page reload', () => {
        render(<RouteError />);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
            i18n.t('route.failed', { ns: 'common' }),
        );
        expect(screen.getByRole('alert')).toHaveTextContent(
            i18n.t('route.retryDescription', { ns: 'common' }),
        );
        expect(
            screen.getByRole('link', { name: i18n.t('route.reload', { ns: 'common' }) }),
        ).toHaveAttribute('href', window.location.href);
    });
});
