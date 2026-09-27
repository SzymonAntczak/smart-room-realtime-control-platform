import type { RecentEventProjection } from '@smart-room/contracts/history';
import type { useTranslation } from 'react-i18next';

type Translate = ReturnType<typeof useTranslation>['t'];

export interface RecentEventPresentation {
    summary: string;
    details: { label: string; value: string }[];
}

export function presentRecentEvent(
    event: RecentEventProjection,
    t: Translate,
): RecentEventPresentation {
    const details: RecentEventPresentation['details'] = [];

    if ('commandId' in event) {
        details.push({ label: t('feed.commandId'), value: event.commandId });
    }

    switch (event.eventType) {
        case 'device.state.reported': {
            const power = event.payload.reportedState.power;

            return {
                summary:
                    power === 'on' || power === 'off'
                        ? t('feed.stateReported', { power: t(`led.${power}`) })
                        : t('feed.stateReportedGeneric'),
                details,
            };
        }

        case 'device.availability.changed':
            addReason(details, event.payload.reason, t);

            return {
                summary: t('feed.availabilityChanged', {
                    previous: t(`feed.availability.${event.payload.previousAvailability}`),
                    current: t(`feed.availability.${event.payload.availability}`),
                }),
                details,
            };
        case 'device.health.changed':
            addReason(details, event.payload.reason, t);

            return {
                summary: t('feed.healthChanged', {
                    previous: t(`feed.health.${event.payload.previousHealth}`),
                    current: t(`feed.health.${event.payload.health}`),
                }),
                details,
            };
        case 'command.requested':
            details.push({
                label: t('feed.requestedBy'),
                value: t(`feed.requester.${event.payload.requestedBy}`),
            });

            return {
                summary: t('feed.commandRequested', {
                    power: t(`led.${event.payload.requestedState.power}`),
                }),
                details,
            };
        case 'command.dispatched':
            details.push({
                label: t('feed.target'),
                value: t(`feed.source.${event.payload.target}`),
            });

            return { summary: t('feed.commandDispatched'), details };
        case 'command.delivery_uncertain':
            details.push({
                label: t('feed.target'),
                value: t(`feed.source.${event.payload.target}`),
            });
            addReason(details, event.payload.reason, t);

            return { summary: t('feed.commandDeliveryUncertain'), details };
        case 'command.failed':
            addReason(details, event.payload.reason, t);
            details.push({ label: t('feed.failureMessage'), value: event.payload.message });

            if (event.payload.requestedState) {
                details.push({
                    label: t('feed.requestedState'),
                    value: t(`led.${event.payload.requestedState.power}`),
                });
            }

            return { summary: t('feed.commandFailed'), details };
        case 'command.timed_out':
            addReason(details, event.payload.reason, t);
            details.push({
                label: t('feed.timeout'),
                value: t('feed.timeoutMs', { count: event.payload.timeoutMs }),
            });

            return { summary: t('feed.commandTimedOut'), details };
        case 'command.confirmed':
            return { summary: t('feed.commandConfirmed'), details };
        case 'storage.gap.recorded':
            addReason(details, event.payload.failureReason, t);
            details.push({ label: t('feed.backfill'), value: t('feed.noBackfill') });

            return { summary: t('feed.storageGap'), details };
    }
}

function addReason(details: RecentEventPresentation['details'], reason: string, t: Translate) {
    details.push({ label: t('feed.reason'), value: reason });
}
