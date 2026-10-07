import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ledScenarioDefinition, temperatureScenarioDefinition } from '../scenarios';

import { DevPanel } from './index';

describe('DevPanel.Content', () => {
    it('keeps the root transparent while exposing the compound component API', () => {
        render(
            <DevPanel>
                <span>Panel contents</span>
            </DevPanel>,
        );

        expect(screen.getByText('Panel contents')).toBeInTheDocument();
        expect(DevPanel.Content).toBeDefined();
        expect(DevPanel.Sidebar).toBeDefined();
        expect(DevPanel.Trigger).toBeDefined();
    });

    it('renders only actions discovered for the selected device', () => {
        render(
            <DevPanel.Content
                availableActions={['confirm_delayed']}
                definition={ledScenarioDefinition}
                isCommandActive={false}
                isOffline={false}
                onRunScenario={() => undefined}
            />,
        );

        expect(
            screen.getByRole('button', { name: 'Potwierdź po 2 sekundach' }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Potwierdź natychmiast' }),
        ).not.toBeInTheDocument();
    });

    it('uses declarative offline and active-command blocking rules', () => {
        const { rerender } = render(
            <DevPanel.Content
                availableActions={['pause_telemetry', 'reconnect_device']}
                definition={temperatureScenarioDefinition}
                isCommandActive={false}
                isOffline
                onRunScenario={() => undefined}
            />,
        );

        expect(screen.getByRole('button', { name: 'Wstrzymaj telemetrię' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Oznacz urządzenie jako online' })).toBeEnabled();

        rerender(
            <DevPanel.Content
                availableActions={['confirm_immediately']}
                definition={ledScenarioDefinition}
                isCommandActive
                isOffline={false}
                onRunScenario={() => undefined}
            />,
        );

        expect(screen.getByRole('button', { name: 'Potwierdź natychmiast' })).toBeDisabled();
    });

    it('keeps an active action label stable while exposing its busy state', () => {
        render(
            <DevPanel.Content
                activeAction="confirm_immediately"
                availableActions={['confirm_immediately']}
                definition={ledScenarioDefinition}
                isCommandActive={false}
                isOffline={false}
                onRunScenario={() => undefined}
            />,
        );

        expect(screen.getByRole('button', { name: 'Potwierdź natychmiast' })).toHaveAttribute(
            'aria-busy',
            'true',
        );
    });
});
