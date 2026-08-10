import type {
    ActiveCommandProjection,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import type { DeviceProjection } from '@smart-room/contracts/projections';
import { Lightbulb, LightbulbOff, Power } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert } from '../../shared/ui/Alert';
import { ControlCard } from '../../shared/ui/ControlCard';

import { type LedAlert, toLedControlViewModel } from './led-control-view-model';
import styles from './LedControl.module.css';
import { useLedCommandRequest } from './use-led-command-request';

export function LedControl({
    device,
    activeCommand,
    recentCommand,
    headerAction,
    interactionLocked = false,
    realtimeUncertain = false,
}: {
    device: DeviceProjection;
    activeCommand?: ActiveCommandProjection;
    recentCommand?: TerminalCommandProjection;
    headerAction?: ReactNode;
    interactionLocked?: boolean;
    realtimeUncertain?: boolean;
}) {
    const { t } = useTranslation(['common', 'dashboard']);
    const { requestPower, submitting, transportError } = useLedCommandRequest(device.deviceId);

    if (device.role !== 'led-output') {
        return null;
    }

    const viewModel = toLedControlViewModel({
        device,
        activeCommand,
        recentCommand,
        transportError,
        realtimeUncertain,
        submitting,
        interactionLocked,
    });
    const PowerIcon = viewModel.isOn ? Lightbulb : LightbulbOff;

    return (
        <ControlCard
            title={device.name}
            titleId={`led-heading-${device.deviceId}`}
            status={t(`availability.${viewModel.availability}`, { ns: 'common' })}
            statusTone={viewModel.availabilityTone}
            headerAction={headerAction}
            bottomAlert={
                <Alert
                    message={viewModel.alert.messages
                        .map((message) => formatAlert(t, message))
                        .join(' ')}
                    variant={viewModel.alert.variant}
                />
            }
        >
            <div className={styles.power} aria-label={t('led.confirmedPower', { ns: 'dashboard' })}>
                <PowerIcon aria-hidden="true" size={28} />
                <span>
                    {t('led.confirmed', { ns: 'dashboard' })}{' '}
                    <strong>
                        {viewModel.hasReportedPower
                            ? viewModel.isOn
                                ? t('led.on', { ns: 'dashboard' })
                                : t('led.off', { ns: 'dashboard' })
                            : t('led.unknown', { ns: 'dashboard' })}
                    </strong>
                </span>
            </div>
            <div className={styles.actions} aria-label={t('led.controls', { ns: 'dashboard' })}>
                <button
                    type="button"
                    aria-label={
                        viewModel.isOn
                            ? t('led.turnOff', { ns: 'dashboard' })
                            : t('led.turnOn', { ns: 'dashboard' })
                    }
                    aria-pressed={viewModel.isOn}
                    className={viewModel.isOn ? styles.toggleOn : styles.toggleOff}
                    disabled={viewModel.isInteractionDisabled}
                    onClick={() => void requestPower(viewModel.isOn ? 'off' : 'on')}
                >
                    <Power aria-hidden="true" size={20} />
                </button>
            </div>
        </ControlCard>
    );
}

function formatAlert(t: ReturnType<typeof useTranslation>['t'], message: LedAlert): string {
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
            return t('led.alert.commandConfirmed', { ns: 'dashboard', time: message.time });
    }
}
