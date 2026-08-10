import type { DeviceScenarioAction } from '@smart-room/contracts/development';

export type ScenarioIcon =
    | 'alert'
    | 'history'
    | 'pause'
    | 'play'
    | 'refresh'
    | 'step-forward'
    | 'timer'
    | 'wifi';

export type ScenarioActionBlockCondition = 'active-command' | 'offline';
export type ScenarioActionOutcome = 'completed' | 'none' | 'selected';

export interface ScenarioActionDefinition {
    readonly action: DeviceScenarioAction;
    readonly blockedWhen?: readonly ScenarioActionBlockCondition[];
    readonly icon: ScenarioIcon;
    readonly labelKey: string;
    readonly outcome: ScenarioActionOutcome;
}

export interface ScenarioSectionDefinition {
    readonly actions: readonly ScenarioActionDefinition[];
    readonly titleKey: string;
}

export interface ScenarioDefinition {
    readonly descriptionKey: string;
    readonly diagnostics?: {
        readonly refreshAfterAction: boolean;
    };
    readonly lockDeviceControlWhileRequest: boolean;
    readonly sections: readonly ScenarioSectionDefinition[];
    readonly titleKey: string;
}
