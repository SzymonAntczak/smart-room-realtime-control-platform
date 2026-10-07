import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DevPanelTrigger } from './DevPanelTrigger';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('DevPanelTrigger', () => {
    it('exposes the associated panel and expanded state', () => {
        render(<DevPanelTrigger deviceId="led-main" expanded onClick={() => undefined} />);

        expect(screen.getByRole('button', { name: 'trigger' })).toHaveAttribute(
            'aria-controls',
            'dev-panel',
        );
        expect(screen.getByRole('button', { name: 'trigger' })).toHaveAttribute('type', 'button');
        expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    });
});
