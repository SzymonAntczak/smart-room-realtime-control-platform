import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DevPanelButton } from '../dev-panel-button/DevPanelButton';

import styles from './DevPanelTrigger.module.css';

export function DevPanelTrigger({
    deviceId,
    expanded,
    onClick,
}: {
    deviceId: string;
    expanded: boolean;
    onClick(): void;
}) {
    const { t } = useTranslation('development');

    return (
        <DevPanelButton
            id={`dev-scenarios-${deviceId}`}
            variant="trigger"
            type="button"
            aria-controls="dev-panel"
            aria-expanded={expanded}
            onClick={onClick}
        >
            <FlaskConical aria-hidden="true" size={16} strokeWidth={1.75} />
            <span className={styles.triggerLabel}>{t('trigger')}</span>
        </DevPanelButton>
    );
}
