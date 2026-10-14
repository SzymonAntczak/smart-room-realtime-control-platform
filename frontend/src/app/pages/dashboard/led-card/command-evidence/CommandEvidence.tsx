import { useTranslation } from 'react-i18next';

import { VolatileEvidence } from '../../volatile-evidence/VolatileEvidence';
import type { LedCommandEvidence } from '../led-card-view-model';

import styles from './CommandEvidence.module.css';

export function CommandEvidence({ evidence }: { evidence: LedCommandEvidence }) {
    const { t } = useTranslation('dashboard');
    const { command, context } = evidence;
    const status =
        context === 'admission'
            ? command.status === 'accepted'
                ? 'admissionAccepted'
                : 'admissionRejected'
            : command.status;
    const delivery = 'delivery' in command ? command.delivery : undefined;

    return (
        <div role="group" aria-label={t(`commandEvidence.${context}`)} className={styles.evidence}>
            <strong>{t(`commandEvidence.${context}`)}</strong>
            <p>{t(`commandEvidence.${status}`)}</p>
            {delivery ? <p>{t(`commandEvidence.${delivery.status}`)}</p> : null}
            <VolatileEvidence
                dimensions={[
                    { label: t('durability.intent'), durability: command.durability },
                    { label: t('durability.lifecycle'), durability: command.lifecycleDurability },
                ]}
            />
        </div>
    );
}
