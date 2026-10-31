import type {
    ActiveCommandProjection,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import type { PowerState } from '@smart-room/contracts/devices';
import type { DeviceProjection } from '@smart-room/contracts/projections';
import { Lightbulb, LightbulbOff, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../../shared/date-time';
import { getDeviceDisplayName } from '../../../shared/device-display';
import { Alert, Button } from '../../../shared/ui';
import { DeviceCard } from '../device-card/DeviceCard';

import { type LedCardAlert, toLedCardViewModel } from './led-card-view-model';
import styles from './LedCard.module.css';
import { useLedCommandRequest } from './useLedCommandRequest';

type ObservationStatus = DeviceProjection['observationStatus'][string];
const noRecentCommands: readonly TerminalCommandProjection[] = [];

export interface LedDeviceProjection extends Omit<
    DeviceProjection,
    'observationStatus' | 'reportedState' | 'role'
> {
    readonly role: 'led-output';
    readonly reportedState: DeviceProjection['reportedState'] & { readonly power?: PowerState };
    readonly observationStatus: DeviceProjection['observationStatus'] & {
        readonly power?: ObservationStatus;
    };
}

export function LedCard({
    device,
    activeCommand,
    recentCommands = noRecentCommands,
    headerAction,
    interactionLocked = false,
    realtimeUncertain = false,
}: {
    device: LedDeviceProjection;
    activeCommand?: ActiveCommandProjection;
    recentCommands?: readonly TerminalCommandProjection[];
    headerAction?: ReactNode;
    interactionLocked?: boolean;
    realtimeUncertain?: boolean;
}) {
    const { t } = useTranslation(['common', 'dashboard']);
    const { requestPower, submitting, transportError, admissionEvidence, correlatedCommand } =
        useLedCommandRequest(device.deviceId, activeCommand, recentCommands);

    const viewModel = toLedCardViewModel({
        device,
        activeCommand,
        recentCommand: recentCommands[0],
        requestError: transportError,
        admissionEvidence,
        correlatedCommand,
        realtimeUncertain,
        submitting,
        interactionLocked,
    });
    const PowerIcon = viewModel.isOn ? Lightbulb : LightbulbOff;

    return (
        <DeviceCard
            title={getDeviceDisplayName(device, (key) => t(key, { ns: 'dashboard' }))}
            titleId={`led-heading-${device.deviceId}`}
            testId={`${device.deviceId}-led-card`}
            status={t(`availability.${viewModel.availability}`, { ns: 'common' })}
            statusTone={viewModel.availabilityTone}
            headerAction={headerAction}
            bottomAlert={
                <Alert
                    message={viewModel.alert.messages
                        .map((message) => formatAlert(t, message))
                        .join(' ')}
                    variant={viewModel.alert.variant}
                    testId={`${device.deviceId}-command-status`}
                />
            }
        >
            <div className={styles.actions} aria-label={t('led.controls', { ns: 'dashboard' })}>
                <Button
                    variant={viewModel.isOn ? 'filled' : 'outlined'}
                    type="button"
                    data-testid={`${device.deviceId}-power-toggle`}
                    aria-label={t(viewModel.isOn ? 'led.turnOff' : 'led.turnOn', {
                        ns: 'dashboard',
                    })}
                    aria-pressed={viewModel.hasReportedPower ? viewModel.isOn : undefined}
                    aria-busy={viewModel.isLoading}
                    className={`${styles.toggle} ${viewModel.isOn ? styles.toggleOn : styles.toggleOff}`}
                    disabled={viewModel.isInteractionDisabled}
                    onClick={() => void requestPower(viewModel.isOn ? 'off' : 'on')}
                >
                    {viewModel.isLoading ? (
                        <LoaderCircle aria-hidden="true" className={styles.spinner} size={20} />
                    ) : (
                        <PowerIcon aria-hidden="true" size={20} />
                    )}
                    <span>
                        {viewModel.hasReportedPower
                            ? viewModel.isOn
                                ? t('led.on', { ns: 'dashboard' })
                                : t('led.off', { ns: 'dashboard' })
                            : t('led.unknown', { ns: 'dashboard' })}
                    </span>
                </Button>
            </div>
        </DeviceCard>
    );
}

function formatAlert(t: ReturnType<typeof useTranslation>['t'], message: LedCardAlert): string {
    switch (message.kind) {
        case 'raw':
            return message.message;
        case 'command-timed-out':
            return t('led.alert.commandTimedOut', { ns: 'dashboard', reason: message.reason });
        case 'offline':
            return t('led.alert.offline', {
                ns: 'dashboard',
                reason: message.reason ? `: ${message.reason}` : '.',
            });
        case 'degraded':
            return message.reason ?? t('led.alert.degraded', { ns: 'dashboard' });
        case 'stale':
            return t('led.alert.stale', { ns: 'dashboard' });
        case 'realtime-reconnecting':
            return t('led.alert.realtimeReconnecting', { ns: 'dashboard' });
        case 'submitting':
            return t('led.alert.submitting', { ns: 'dashboard' });
        case 'requested':
            return t('led.alert.requested', {
                ns: 'dashboard',
                power: t(`led.${message.power}`, { ns: 'dashboard' }),
            });
        case 'command-confirmed':
            return t('led.alert.commandConfirmed', {
                ns: 'dashboard',
                time: formatTimestamp(message.time),
            });
    }
}
