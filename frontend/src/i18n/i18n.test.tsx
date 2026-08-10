import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Alert } from '../app/shared/ui/Alert';

import { i18n } from './index';

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
