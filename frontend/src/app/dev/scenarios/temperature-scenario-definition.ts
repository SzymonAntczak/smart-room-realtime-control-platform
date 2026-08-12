import type { ScenarioDefinition } from '../dev-panel';

const telemetryBlockedWhenOffline = ['offline'] as const;

export const temperatureScenarioDefinition = {
    titleKey: 'scenarios.temperature.title',
    descriptionKey: 'scenarios.temperature.description',
    lockDeviceControlWhileRequest: false,
    diagnostics: { refreshAfterAction: true },
    sections: [
        {
            titleKey: 'scenarios.temperature.freshness',
            actions: [
                {
                    action: 'pause_telemetry',
                    labelKey: 'scenarios.temperature.actions.pause',
                    icon: 'pause',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
                {
                    action: 'resume_telemetry',
                    labelKey: 'scenarios.temperature.actions.resume',
                    icon: 'play',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
                {
                    action: 'emit_next_reading',
                    labelKey: 'scenarios.temperature.actions.emitNext',
                    icon: 'step-forward',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
                {
                    action: 'replay_last_reading',
                    labelKey: 'scenarios.temperature.actions.replay',
                    icon: 'history',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
                {
                    action: 'emit_invalid_reading',
                    labelKey: 'scenarios.temperature.actions.emitInvalid',
                    icon: 'alert',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
                {
                    action: 'emit_future_dated_reading',
                    labelKey: 'scenarios.temperature.actions.emitFutureDated',
                    icon: 'alert',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
                {
                    action: 'reset',
                    labelKey: 'scenarios.temperature.actions.reset',
                    icon: 'refresh',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
            ],
        },
        {
            titleKey: 'scenarios.temperature.availability',
            actions: [
                {
                    action: 'disconnect_device',
                    labelKey: 'scenarios.temperature.actions.disconnect',
                    icon: 'pause',
                    outcome: 'completed',
                },
                {
                    action: 'reconnect_device',
                    labelKey: 'scenarios.temperature.actions.reconnect',
                    icon: 'play',
                    outcome: 'completed',
                },
            ],
        },
        {
            titleKey: 'scenarios.temperature.health',
            actions: [
                {
                    action: 'degrade_device',
                    labelKey: 'scenarios.temperature.actions.degrade',
                    icon: 'alert',
                    outcome: 'completed',
                },
                {
                    action: 'recover_device',
                    labelKey: 'scenarios.temperature.actions.recover',
                    icon: 'refresh',
                    outcome: 'completed',
                },
            ],
        },
    ],
} as const satisfies ScenarioDefinition;
