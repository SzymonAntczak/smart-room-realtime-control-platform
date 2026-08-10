import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ledScenarioDefinition, temperatureScenarioDefinition } from '../scenarios';

import { DevPanel } from './DevPanel';

describe('DevPanel.Content', () => {
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

        expect(screen.getByRole('button', { name: 'Confirm after 2 seconds' })).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Confirm immediately' }),
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

        expect(screen.getByRole('button', { name: 'Pause telemetry' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Mark device online' })).toBeEnabled();

        rerender(
            <DevPanel.Content
                availableActions={['confirm_immediately']}
                definition={ledScenarioDefinition}
                isCommandActive
                isOffline={false}
                onRunScenario={() => undefined}
            />,
        );

        expect(screen.getByRole('button', { name: 'Confirm immediately' })).toBeDisabled();
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

        expect(screen.getByRole('button', { name: 'Confirm immediately' })).toHaveAttribute(
            'aria-busy',
            'true',
        );
    });
});
