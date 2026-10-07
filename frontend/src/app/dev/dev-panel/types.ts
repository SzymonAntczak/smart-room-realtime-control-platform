import type { ScenarioDefinition } from './scenario-definition';

export interface DevPanelTarget {
    readonly definition: ScenarioDefinition;
    readonly deviceId: string;
}
