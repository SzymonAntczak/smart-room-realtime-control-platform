import { DevPanelContent } from './dev-panel-content/DevPanelContent';
import { DevPanelSidebar } from './dev-panel-sidebar/DevPanelSidebar';
import { DevPanelTrigger } from './dev-panel-trigger/DevPanelTrigger';
import { DevPanelRoot } from './DevPanel';

export const DevPanel = Object.assign(DevPanelRoot, {
    Content: DevPanelContent,
    Sidebar: DevPanelSidebar,
    Trigger: DevPanelTrigger,
});

export type { DevPanelTarget } from './types';
export type { ScenarioDefinition } from './scenario-definition';
