import type { DeviceScenarioAction } from '@smart-room/contracts/development';
import { useTranslation } from 'react-i18next';

import { DevPanelAction } from '../dev-panel-action/DevPanelAction';
import type { ScenarioDefinition } from '../scenario-definition';

import styles from './DevPanelContent.module.css';

export function DevPanelContent({
    activeAction,
    availableActions,
    definition,
    isCommandActive,
    isOffline,
    message,
    onRunScenario,
}: {
    activeAction?: DeviceScenarioAction;
    availableActions: readonly DeviceScenarioAction[];
    definition: ScenarioDefinition;
    isCommandActive: boolean;
    isOffline: boolean;
    message?: string;
    onRunScenario(action: DeviceScenarioAction): void;
}) {
    const { t } = useTranslation('development');

    return (
        <section className={styles.panel}>
            <p className={styles.eyebrow}>{t('only')}</p>
            <h2>{t(definition.titleKey)}</h2>
            <p className={styles.description}>{t(definition.descriptionKey)}</p>
            {isOffline && hasOfflineBlockedAction(definition) ? (
                <p>{t('telemetryOffline')}</p>
            ) : null}
            <div>
                {definition.sections.map((section) => {
                    const actions = section.actions.filter((action) =>
                        availableActions.includes(action.action),
                    );

                    if (actions.length === 0) {
                        return null;
                    }

                    return (
                        <section key={section.titleKey} className={styles.section}>
                            <h3>{t(section.titleKey)}</h3>
                            <div className={styles.actions}>
                                {actions.map((action) => (
                                    <DevPanelAction
                                        key={action.action}
                                        action={action}
                                        disabled={
                                            activeAction !== undefined ||
                                            isBlocked(action, isOffline, isCommandActive)
                                        }
                                        isActive={activeAction === action.action}
                                        onClick={() => onRunScenario(action.action)}
                                    />
                                ))}
                            </div>
                        </section>
                    );
                })}
            </div>
            {message ? (
                <p className={styles.status} role="status">
                    {message}
                </p>
            ) : null}
        </section>
    );
}

function hasOfflineBlockedAction(definition: ScenarioDefinition): boolean {
    return definition.sections.some((section) =>
        section.actions.some((action) => action.blockedWhen?.includes('offline')),
    );
}

function isBlocked(
    action: ScenarioDefinition['sections'][number]['actions'][number],
    isOffline: boolean,
    isCommandActive: boolean,
): boolean {
    return Boolean(
        (isOffline && action.blockedWhen?.includes('offline')) ||
        (isCommandActive && action.blockedWhen?.includes('active-command')),
    );
}
