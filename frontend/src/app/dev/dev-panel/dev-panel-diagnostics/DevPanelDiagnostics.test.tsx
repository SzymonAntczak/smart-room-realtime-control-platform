import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { formatTimestamp } from '../../../shared/date-time';

import { DevPanelDiagnostics } from './DevPanelDiagnostics';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('DevPanelDiagnostics', () => {
    it('disables refresh while a scenario action is active', () => {
        render(
            <DevPanelDiagnostics isActionActive isRefreshing={false} onRefresh={() => undefined} />,
        );

        expect(screen.getByRole('button', { name: 'diagnostics.refresh' })).toBeDisabled();
    });

    it('renders retained metadata and keeps it visible beside a failed refresh', () => {
        const recordedAt = '2026-09-10T10:00:00.000Z';
        const diagnostics = {
            historyGenerationId: 'generation-1',
            entries: [
                {
                    internalSequence: 1,
                    reason: 'duplicate_event' as const,
                    recordedAt,
                    deviceId: 'temp-desk',
                    eventType: 'telemetry.reading.recorded',
                },
            ],
        };
        const { rerender } = render(
            <DevPanelDiagnostics
                diagnostics={diagnostics}
                isActionActive={false}
                isRefreshing={false}
                onRefresh={vi.fn()}
            />,
        );
        expect(screen.getByRole('listitem')).toHaveTextContent('duplicate_event');
        expect(screen.getByText(formatTimestamp(recordedAt))).toHaveAttribute(
            'datetime',
            recordedAt,
        );
        rerender(
            <DevPanelDiagnostics
                diagnostics={diagnostics}
                errorMessage="Refresh unavailable"
                isActionActive={false}
                isRefreshing={false}
                onRefresh={vi.fn()}
            />,
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Refresh unavailable');
        expect(screen.getByRole('listitem')).toHaveTextContent('temp-desk');
    });
});
