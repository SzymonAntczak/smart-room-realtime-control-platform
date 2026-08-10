import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ledScenarioDefinition, temperatureScenarioDefinition } from '../scenarios';

import { DevPanel } from './DevPanel';

describe('DevPanel.Sidebar', () => {
    afterEach(() => vi.unstubAllGlobals());

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
            await screen.findByRole('heading', { name: 'Temperature scenarios' }),
        ).toBeInTheDocument();
        rerender(
            <DevPanel.Sidebar
                target={{ definition: ledScenarioDefinition, deviceId: 'led-main' }}
                snapshot={createSnapshot()}
                onClose={() => undefined}
                onRequestChange={() => undefined}
            />,
        );

        expect(await screen.findByRole('heading', { name: 'LED scenarios' })).toBeInTheDocument();
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

        await user.click(await screen.findByRole('button', { name: 'Pause telemetry' }));

        expect(await screen.findByRole('status')).toHaveTextContent('Pause telemetry completed.');
        expect(await screen.findByText('Ignored events: 0')).toBeInTheDocument();
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

        await user.click(await screen.findByRole('button', { name: 'Confirm after 2 seconds' }));

        expect(await screen.findByRole('status')).toHaveTextContent(
            'Confirm after 2 seconds selected for the next LED command.',
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

        await user.click(await screen.findByRole('button', { name: 'Confirm immediately' }));

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

        await user.click(await screen.findByRole('button', { name: 'Confirm after 2 seconds' }));

        expect(await screen.findByRole('status')).toHaveTextContent(
            'Scenario control request failed (503).',
        );
    });
});

function createSnapshot(): RoomSnapshotProjection {
    return {
        roomName: 'Smart Room',
        updatedAt: '2026-08-06T12:00:00Z',
        devices: [],
        activeCommands: [],
        recentCommands: [],
    };
}
