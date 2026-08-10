import type { ScenarioDefinition } from '../dev-panel';

const telemetryBlockedWhenOffline = ['offline'] as const;

export const temperatureScenarioDefinition = {
    title: 'Temperature scenarios',
    description:
        'Controls operate the local simulator through the backend. Room state still arrives through the realtime stream: a snapshot baseline followed by device updates.',
    lockDeviceControlWhileRequest: false,
    diagnostics: { refreshAfterAction: true },
    sections: [
        {
            title: 'Freshness and telemetry',
            actions: [
                {
                    action: 'pause_telemetry',
                    label: 'Pause telemetry',
                    icon: 'pause',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
                {
                    action: 'resume_telemetry',
                    label: 'Resume telemetry',
                    icon: 'play',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
                {
                    action: 'emit_next_reading',
                    label: 'Emit next reading',
                    icon: 'step-forward',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
                {
                    action: 'replay_last_reading',
                    label: 'Replay last reading',
                    icon: 'history',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
                {
                    action: 'emit_invalid_reading',
                    label: 'Emit invalid reading',
                    icon: 'alert',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
                {
                    action: 'reset',
                    label: 'Reset scenario',
                    icon: 'refresh',
                    outcome: 'completed',
                    blockedWhen: telemetryBlockedWhenOffline,
                },
            ],
        },
        {
            title: 'Availability',
            actions: [
                {
                    action: 'disconnect_device',
                    label: 'Mark device offline',
                    icon: 'pause',
                    outcome: 'completed',
                },
                {
                    action: 'reconnect_device',
                    label: 'Mark device online',
                    icon: 'play',
                    outcome: 'completed',
                },
            ],
        },
        {
            title: 'Health',
            actions: [
                {
                    action: 'degrade_device',
                    label: 'Degrade device health',
                    icon: 'alert',
                    outcome: 'completed',
                },
                {
                    action: 'recover_device',
                    label: 'Recover device health',
                    icon: 'refresh',
                    outcome: 'completed',
                },
            ],
        },
    ],
} as const satisfies ScenarioDefinition;
