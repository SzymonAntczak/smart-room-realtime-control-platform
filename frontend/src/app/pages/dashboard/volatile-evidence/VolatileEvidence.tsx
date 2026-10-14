import type { EvidenceDurability } from '@smart-room/contracts/storage';
import { useTranslation } from 'react-i18next';

import styles from './VolatileEvidence.module.css';

export function VolatileEvidence({
    dimensions,
}: {
    dimensions: readonly { label: string; durability: EvidenceDurability }[];
}) {
    const { t } = useTranslation('dashboard');
    const volatile = dimensions.filter((dimension) => dimension.durability === 'volatile');

    return volatile.length > 0 ? (
        <ul className={styles.evidence}>
            {volatile.map(({ label }) => (
                <li key={label}>{t('durability.volatileDimension', { dimension: label })}</li>
            ))}
        </ul>
    ) : null;
}
