import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DevPanelDiagnostics } from './DevPanelDiagnostics';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('DevPanelDiagnostics', () => {
    it('disables refresh while a scenario action is active', () => {
        render(
            <DevPanelDiagnostics isActionActive isRefreshing={false} onRefresh={() => undefined} />,
        );

        expect(screen.getByRole('button', { name: 'diagnostics.refresh' })).toBeDisabled();
    });
});
