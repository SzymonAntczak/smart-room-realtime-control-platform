import type { ScenarioDefinition } from '../dev-panel';

export const ledScenarioDefinition = {
    titleKey: 'scenarios.led.title',
    descriptionKey: 'scenarios.led.description',
    lockDeviceControlWhileRequest: true,
    sections: [
        {
            titleKey: 'scenarios.led.commandBehavior',
            actions: [
                {
                    action: 'confirm_immediately',
                    labelKey: 'scenarios.led.actions.confirmImmediately',
                    icon: 'timer',
                    outcome: 'none',
                    blockedWhen: ['active-command'],
                },
                {
                    action: 'confirm_delayed',
                    labelKey: 'scenarios.led.actions.confirmDelayed',
                    icon: 'timer',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
                {
                    action: 'reject_command',
                    labelKey: 'scenarios.led.actions.reject',
                    icon: 'timer',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
                {
                    action: 'omit_confirmation',
                    labelKey: 'scenarios.led.actions.omitConfirmation',
                    icon: 'timer',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
                {
                    action: 'report_after_timeout',
                    labelKey: 'scenarios.led.actions.reportAfterTimeout',
                    icon: 'timer',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
            ],
        },
        {
            titleKey: 'scenarios.led.availability',
            actions: [
                {
                    action: 'disconnect_device',
                    labelKey: 'scenarios.led.actions.disconnect',
                    icon: 'wifi',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
                {
                    action: 'reconnect_device',
                    labelKey: 'scenarios.led.actions.reconnect',
                    icon: 'wifi',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
            ],
        },
        {
            titleKey: 'scenarios.led.health',
            actions: [
                {
                    action: 'degrade_device',
                    labelKey: 'scenarios.led.actions.degrade',
                    icon: 'alert',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
                {
                    action: 'recover_device',
                    labelKey: 'scenarios.led.actions.recover',
                    icon: 'alert',
                    outcome: 'selected',
                    blockedWhen: ['active-command'],
                },
            ],
        },
    ],
} as const satisfies ScenarioDefinition;
