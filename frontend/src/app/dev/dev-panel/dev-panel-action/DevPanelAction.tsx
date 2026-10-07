import {
    CircleAlert,
    History,
    Pause,
    Play,
    RotateCcw,
    StepForward,
    Timer,
    Wifi,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DevPanelButton } from '../dev-panel-button/DevPanelButton';
import type { ScenarioActionDefinition, ScenarioIcon } from '../scenario-definition';

import styles from './DevPanelAction.module.css';

const iconByName: Record<ScenarioIcon, typeof Timer> = {
    alert: CircleAlert,
    history: History,
    pause: Pause,
    play: Play,
    refresh: RotateCcw,
    'step-forward': StepForward,
    timer: Timer,
    wifi: Wifi,
};

export function DevPanelAction({
    action,
    disabled,
    isActive,
    onClick,
}: {
    action: ScenarioActionDefinition;
    disabled: boolean;
    isActive: boolean;
    onClick(): void;
}) {
    const { t } = useTranslation('development');
    const Icon = iconByName[action.icon];

    return (
        <DevPanelButton
            className={isActive ? styles.active : undefined}
            type="button"
            aria-busy={isActive || undefined}
            disabled={disabled}
            onClick={onClick}
        >
            <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
            {t(action.labelKey)}
        </DevPanelButton>
    );
}
