import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { i18n } from '../../i18n';
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
            screen.getByRole('button', {
                name: i18n.t('scenarios.led.actions.confirmDelayed', { ns: 'development' }),
            }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('button', {
                name: i18n.t('scenarios.led.actions.confirmImmediately', { ns: 'development' }),
            }),
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

        expect(
            screen.getByRole('button', {
                name: i18n.t('scenarios.temperature.actions.pause', { ns: 'development' }),
            }),
        ).toBeDisabled();
        expect(
            screen.getByRole('button', {
                name: i18n.t('scenarios.temperature.actions.reconnect', { ns: 'development' }),
            }),
        ).toBeEnabled();

        rerender(
            <DevPanel.Content
                availableActions={['confirm_immediately']}
                definition={ledScenarioDefinition}
                isCommandActive
                isOffline={false}
                onRunScenario={() => undefined}
            />,
        );

        expect(
            screen.getByRole('button', {
                name: i18n.t('scenarios.led.actions.confirmImmediately', { ns: 'development' }),
            }),
        ).toBeDisabled();
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

        expect(
            screen.getByRole('button', {
                name: i18n.t('scenarios.led.actions.confirmImmediately', { ns: 'development' }),
            }),
        ).toHaveAttribute('aria-busy', 'true');
    });
});
