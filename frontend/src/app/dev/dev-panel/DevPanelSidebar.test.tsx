import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPendingCommand } from '../../../test/room/room-realtime-fixtures';
import { i18n } from '../../i18n';
import { ledScenarioDefinition, temperatureScenarioDefinition } from '../scenarios';

import { DevPanel } from './index';

const formatTimestamp = vi.hoisted(() => vi.fn(() => 'formatted local timestamp'));

vi.mock('../../features/date-time', () => ({ formatTimestamp }));

describe('DevPanel.Sidebar', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('clears the selected LED scenario when a command becomes active and keeps it cleared afterwards', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            deviceId: 'led-main',
                            scenarios: [{ action: 'confirm_delayed' }],
                        }),
                    ),
                )
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({ action: 'confirm_delayed', status: 'completed' }),
                    ),
                ),
        );
        const target = { definition: ledScenarioDefinition, deviceId: 'led-main' };
        const onRequestChange = vi.fn();
        const { rerender } = render(
            <DevPanel.Sidebar
                target={target}
                snapshot={createSnapshot()}
                onClose={() => undefined}
                onRequestChange={onRequestChange}
            />,
        );
        await userEvent.setup().click(
            await screen.findByRole('button', {
                name: i18n.t('scenarios.led.actions.confirmDelayed', { ns: 'development' }),
            }),
        );
        expect(await screen.findByRole('status')).toHaveTextContent(
            i18n.t('actionSelected', {
                ns: 'development',
                action: i18n.t('scenarios.led.actions.confirmDelayed', { ns: 'development' }),
            }),
        );

        rerender(
            <DevPanel.Sidebar
                target={target}
                snapshot={{ ...createSnapshot(), activeCommands: [createPendingCommand()] }}
                onClose={() => undefined}
                onRequestChange={onRequestChange}
            />,
        );
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        rerender(
            <DevPanel.Sidebar
                target={target}
                snapshot={createSnapshot()}
                onClose={() => undefined}
                onRequestChange={onRequestChange}
            />,
        );
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('replaces one device definition with another in the same sidebar', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            deviceId: 'temp-desk',
                            scenarios: [{ action: 'pause_telemetry' }],
                        }),
                    ),
                )
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            deviceId: 'led-main',
                            scenarios: [{ action: 'confirm_immediately' }],
                        }),
                    ),
                ),
        );
        const { rerender } = render(
            <DevPanel.Sidebar
                target={{ definition: temperatureScenarioDefinition, deviceId: 'temp-desk' }}
                snapshot={createSnapshot()}
                onClose={() => undefined}
                onRequestChange={() => undefined}
            />,
        );

        expect(
            await screen.findByRole('heading', {
                name: i18n.t('scenarios.temperature.title', { ns: 'development' }),
            }),
        ).toBeInTheDocument();
        rerender(
            <DevPanel.Sidebar
                target={{ definition: ledScenarioDefinition, deviceId: 'led-main' }}
                snapshot={createSnapshot()}
                onClose={() => undefined}
                onRequestChange={() => undefined}
            />,
        );

        expect(
            await screen.findByRole('heading', {
                name: i18n.t('scenarios.led.title', { ns: 'development' }),
            }),
        ).toBeInTheDocument();
        expect(screen.getAllByRole('complementary')).toHaveLength(1);
    });

    it('uses the configured success outcome and refreshes configured diagnostics', async () => {
        const user = userEvent.setup();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        deviceId: 'temp-desk',
                        scenarios: [{ action: 'pause_telemetry' }],
                    }),
                ),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ action: 'pause_telemetry', status: 'completed' })),
            )
            .mockResolvedValueOnce(new Response(JSON.stringify({ ignoredEvents: [] })));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <DevPanel.Sidebar
                target={{ definition: temperatureScenarioDefinition, deviceId: 'temp-desk' }}
                snapshot={createSnapshot()}
                onClose={() => undefined}
                onRequestChange={() => undefined}
            />,
        );

        await user.click(
            await screen.findByRole('button', {
                name: i18n.t('scenarios.temperature.actions.pause', { ns: 'development' }),
            }),
        );

        expect(await screen.findByRole('status')).toHaveTextContent(
            i18n.t('actionCompleted', {
                ns: 'development',
                action: i18n.t('scenarios.temperature.actions.pause', { ns: 'development' }),
            }),
        );
        expect(
            await screen.findByText(
                i18n.t('diagnostics.ignoredEvents', { ns: 'development', count: 0 }),
            ),
        ).toBeInTheDocument();
    });

    it('uses the LED selection outcome without presenting a confirmed device state', async () => {
        const user = userEvent.setup();
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            deviceId: 'led-main',
                            scenarios: [{ action: 'confirm_delayed' }],
                        }),
                    ),
                )
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({ action: 'confirm_delayed', status: 'completed' }),
                    ),
                ),
        );
        render(
            <DevPanel.Sidebar
                target={{ definition: ledScenarioDefinition, deviceId: 'led-main' }}
                snapshot={createSnapshot()}
                onClose={() => undefined}
                onRequestChange={() => undefined}
            />,
        );

        await user.click(
            await screen.findByRole('button', {
                name: i18n.t('scenarios.led.actions.confirmDelayed', { ns: 'development' }),
            }),
        );

        expect(await screen.findByRole('status')).toHaveTextContent(
            i18n.t('actionSelected', {
                ns: 'development',
                action: i18n.t('scenarios.led.actions.confirmDelayed', { ns: 'development' }),
            }),
        );
    });

    it('does not show a selection status for confirm immediately', async () => {
        const user = userEvent.setup();
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            deviceId: 'led-main',
                            scenarios: [{ action: 'confirm_immediately' }],
                        }),
                    ),
                )
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({ action: 'confirm_immediately', status: 'completed' }),
                    ),
                ),
        );
        render(
            <DevPanel.Sidebar
                target={{ definition: ledScenarioDefinition, deviceId: 'led-main' }}
                snapshot={createSnapshot()}
                onClose={() => undefined}
                onRequestChange={() => undefined}
            />,
        );

        await user.click(
            await screen.findByRole('button', {
                name: i18n.t('scenarios.led.actions.confirmImmediately', { ns: 'development' }),
            }),
        );

        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    });

    it('shows an execution error without synthesizing device state', async () => {
        const user = userEvent.setup();
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            deviceId: 'led-main',
                            scenarios: [{ action: 'confirm_delayed' }],
                        }),
                    ),
                )
                .mockResolvedValueOnce(new Response(null, { status: 503 })),
        );
        render(
            <DevPanel.Sidebar
                target={{ definition: ledScenarioDefinition, deviceId: 'led-main' }}
                snapshot={createSnapshot()}
                onClose={() => undefined}
                onRequestChange={() => undefined}
            />,
        );

        await user.click(
            await screen.findByRole('button', {
                name: i18n.t('scenarios.led.actions.confirmDelayed', { ns: 'development' }),
            }),
        );

        expect(await screen.findByRole('status')).toHaveTextContent(
            i18n.t('scenarioRequestFailed', { ns: 'development' }),
        );
    });
});

it('formats diagnostic timestamps for the browser before rendering them', async () => {
    vi.stubGlobal(
        'fetch',
        vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        deviceId: 'temp-desk',
                        scenarios: [{ action: 'pause_telemetry' }],
                    }),
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        ignoredEvents: [
                            {
                                diagnosticId: 'diagnostic-1',
                                reason: 'invalid_payload',
                                observedAt: '2026-08-06T12:00:00Z',
                            },
                        ],
                    }),
                ),
            ),
    );
    render(
        <DevPanel.Sidebar
            target={{ definition: temperatureScenarioDefinition, deviceId: 'temp-desk' }}
            snapshot={createSnapshot()}
            onClose={() => undefined}
            onRequestChange={() => undefined}
        />,
    );

    await userEvent.setup().click(
        await screen.findByRole('button', {
            name: i18n.t('diagnostics.refresh', { ns: 'development' }),
        }),
    );

    expect(formatTimestamp).toHaveBeenCalledWith('2026-08-06T12:00:00Z');
    expect(await screen.findByText('formatted local timestamp')).toBeInTheDocument();
});

function createSnapshot(): RoomSnapshotProjection {
    return {
        roomName: 'Smart Room',
        updatedAt: '2026-08-06T12:00:00Z',
        devices: [],
        activeCommands: [],
        recentCommands: [],
        recentEvents: [],
        platform: {
            storage: {
                status: 'available',
                changedAt: '2026-08-06T12:00:00Z',
                historyGenerationId: 'generation-test',
                storedThroughSequence: 0,
            },
        },
    };
}
