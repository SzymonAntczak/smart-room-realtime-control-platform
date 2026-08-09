import { FlaskConical } from 'lucide-react';

import styles from './DeviceScenarioTrigger.module.css';

export function DeviceScenarioTrigger({
    deviceId,
    expanded,
    onClick,
}: {
    deviceId: string;
    expanded: boolean;
    onClick(): void;
}) {
    return (
        <button
            id={`dev-scenarios-${deviceId}`}
            className={styles.toggle}
            type="button"
            aria-controls="device-scenario-sidebar"
            aria-expanded={expanded}
            onClick={onClick}
        >
            <FlaskConical aria-hidden="true" size={16} strokeWidth={1.75} />
            <span className={styles.toggleLabel}>Dev scenarios</span>
        </button>
    );
}
