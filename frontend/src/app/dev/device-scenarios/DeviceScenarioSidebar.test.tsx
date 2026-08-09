import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeviceScenarioSidebar } from './DeviceScenarioSidebar';

describe('DeviceScenarioSidebar', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('replaces temperature content with LED content in one sidebar', async () => {
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
        const onClose = vi.fn();
        const { rerender } = render(
            <DeviceScenarioSidebar
                target={{ kind: 'temperature', deviceId: 'temp-desk', telemetryUnavailable: false }}
                onClose={onClose}
                onLedScenarioRequestChange={vi.fn()}
            />,
        );

        expect(
            await screen.findByRole('heading', { name: 'Temperature scenarios' }),
        ).toBeInTheDocument();
        rerender(
            <DeviceScenarioSidebar
                target={{ kind: 'led', deviceId: 'led-main', isCommandActive: false }}
                onClose={onClose}
                onLedScenarioRequestChange={vi.fn()}
            />,
        );

        expect(await screen.findByRole('heading', { name: 'LED scenarios' })).toBeInTheDocument();
        expect(screen.getAllByRole('complementary')).toHaveLength(1);
        expect(
            screen.queryByRole('heading', { name: 'Temperature scenarios' }),
        ).not.toBeInTheDocument();
    });
});
