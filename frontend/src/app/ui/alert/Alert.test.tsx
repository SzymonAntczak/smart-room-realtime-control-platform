import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '../../i18n';

import { Alert } from './Alert';

describe('i18n fallback rendering', () => {
    afterEach(async () => {
        await i18n.changeLanguage('pl');
    });

    it('renders Polish resources when an unsupported locale is requested', async () => {
        await i18n.changeLanguage('en-GB');
        render(<Alert />);

        expect(screen.getByText('Brak bieżących alertów.')).toBeInTheDocument();
    });
});
