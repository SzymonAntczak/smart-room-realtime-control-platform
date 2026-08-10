import type {
    ActiveCommandProjection,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import type { DeviceProjection } from '@smart-room/contracts/projections';
import { Lightbulb, LightbulbOff, Power } from 'lucide-react';
import type { ReactNode } from 'react';

import { Alert } from '../../shared/ui/Alert';
import { ControlCard } from '../../shared/ui/ControlCard';

import { toLedControlViewModel } from './led-control-view-model';
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
    const { requestPower, submitting, transportError } = useLedCommandRequest(device?.deviceId);

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
            status={viewModel.availabilityLabel}
            statusTone={viewModel.availabilityTone}
            headerAction={headerAction}
            bottomAlert={<Alert {...viewModel.alert} />}
        >
            <div className={styles.power} aria-label="Confirmed LED power">
                <PowerIcon aria-hidden="true" size={28} />
                <span>
                    Confirmed:{' '}
                    <strong>
                        {viewModel.hasReportedPower ? (viewModel.isOn ? 'On' : 'Off') : 'Unknown'}
                    </strong>
                </span>
            </div>
            <div className={styles.actions} aria-label="LED power controls">
                <button
                    type="button"
                    aria-label={viewModel.isOn ? 'Turn off' : 'Turn on'}
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
