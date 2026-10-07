import {
    Dashboard,
    type DeviceControlExtension,
    type RenderableDeviceProjection,
} from '../pages/dashboard/Dashboard';

import { DevPanel, type DevPanelTarget } from './dev-panel';
import { ledScenarioDefinition, temperatureScenarioDefinition } from './scenarios';
import { useAppDev } from './useAppDev';

export function AppDev() {
    const {
        closeScenarioSidebar,
        isDeviceControlLocked,
        openScenarioSidebar,
        scenarioTarget,
        updateScenarioRequestCount,
    } = useAppDev();

    function getDeviceExtension(
        device: RenderableDeviceProjection,
    ): DeviceControlExtension | undefined {
        const target = toScenarioTarget(device);

        if (!target) {
            return undefined;
        }

        return {
            headerAction: (
                <DevPanel.Trigger
                    deviceId={device.deviceId}
                    expanded={scenarioTarget?.deviceId === device.deviceId}
                    onClick={() => openScenarioSidebar(target)}
                />
            ),
            interactionLocked: isDeviceControlLocked(
                device.deviceId,
                target.definition.lockDeviceControlWhileRequest,
            ),
        };
    }

    return (
        <Dashboard
            getDeviceExtension={getDeviceExtension}
            renderOverlay={(snapshot) =>
                scenarioTarget && snapshot ? (
                    <DevPanel.Sidebar
                        key={scenarioTarget.deviceId}
                        target={scenarioTarget}
                        snapshot={snapshot}
                        onClose={closeScenarioSidebar}
                        onRequestChange={updateScenarioRequestCount}
                    />
                ) : null
            }
        />
    );
}

function toScenarioTarget(device: RenderableDeviceProjection): DevPanelTarget | undefined {
    switch (device.role) {
        case 'temperature-sensor':
            return { definition: temperatureScenarioDefinition, deviceId: device.deviceId };
        case 'led-output':
            return { definition: ledScenarioDefinition, deviceId: device.deviceId };
        default:
            return undefined;
    }
}
