import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ledScenarioDefinition } from '../../scenarios';

import { DevPanelSidebar } from './DevPanelSidebar';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../useDevPanel', () => ({
    useDevPanel: () => ({
        actions: undefined,
        client: undefined,
        closeButtonRef: { current: null },
        loadError: undefined,
    }),
}));

describe('DevPanelSidebar', () => {
    it('does not render the drawer before the scenario client is ready', () => {
        const snapshot: Pick<
            RoomSnapshotProjection,
            'devices' | 'activeCommands' | 'recentCommands'
        > = {
            devices: [],
            activeCommands: [],
            recentCommands: [],
        };
        render(
            <DevPanelSidebar
                target={{ definition: ledScenarioDefinition, deviceId: 'led-main' }}
                snapshot={snapshot}
                onClose={() => undefined}
                onRequestChange={() => undefined}
            />,
        );

        expect(screen.queryByRole('complementary')).toBeNull();
    });
});
