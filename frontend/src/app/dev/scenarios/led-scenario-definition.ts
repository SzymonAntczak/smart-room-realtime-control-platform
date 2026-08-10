import type { ScenarioDefinition } from '../dev-panel';

export const ledScenarioDefinition = {
    title: 'LED scenarios',
    description:
        'Select how the next LED command behaves. This does not change the confirmed LED state.',
    lockDeviceControlWhileRequest: true,
    sections: [
        {
            title: 'Command behavior',
            actions: [
                {
                    action: 'confirm_immediately',
                    label: 'Confirm immediately',
                    icon: 'timer',
                    outcome: 'none',
                    blockedWhen: ['active-command'],
                },
                {
                    action: 'confirm_delayed',
                    label: 'Confirm after 2 seconds',
                    icon: 'timer',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
                {
                    action: 'reject_command',
                    label: 'Reject next command',
                    icon: 'timer',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
                {
                    action: 'omit_confirmation',
                    label: 'Omit confirmation',
                    icon: 'timer',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
                {
                    action: 'report_after_timeout',
                    label: 'Report after timeout',
                    icon: 'timer',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
            ],
        },
        {
            title: 'Availability',
            actions: [
                {
                    action: 'disconnect_device',
                    label: 'Mark device offline',
                    icon: 'wifi',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
                {
                    action: 'reconnect_device',
                    label: 'Mark device online',
                    icon: 'wifi',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
            ],
        },
        {
            title: 'Health',
            actions: [
                {
                    action: 'degrade_device',
                    label: 'Mark device degraded',
                    icon: 'alert',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
                {
                    action: 'recover_device',
                    label: 'Recover device health',
                    icon: 'alert',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
            ],
        },
    ],
} as const satisfies ScenarioDefinition;
