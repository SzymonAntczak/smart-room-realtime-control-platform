import { useTranslation } from 'react-i18next';

import { Button } from '../../../ui';
import { getDeviceDisplayName } from '../../device-display';
import type { HistoryDevice } from '../history-context';

import styles from './HistoryFilters.module.css';
import { useHistoryFilters } from './useHistoryFilters';

export function HistoryFilters({ device }: { device?: HistoryDevice }) {
    const { t } = useTranslation('dashboard');
    const {
        devices,
        form,
        setForm,
        appliedForm,
        formError,
        setFormError,
        formId,
        reloadTooltip,
        setReloadTooltip,
        handleSubmit,
        handleReload,
        handleClear,
    } = useHistoryFilters(device?.deviceId);

    return (
        <form
            className={styles.form}
            data-fixed-device={device ? true : undefined}
            onSubmit={handleSubmit}
            noValidate
        >
            <div className={styles.controlLayout}>
                <div className={styles.filters}>
                    {!device ? (
                        <label className={styles.deviceFilter}>
                            <span>{t('history.device')}</span>
                            <select
                                value={form.deviceId}
                                onChange={(event) => {
                                    setForm((current) => ({
                                        ...current,
                                        deviceId: event.target.value,
                                    }));
                                    setFormError(null);
                                }}
                            >
                                <option value="">{t('history.anyDevice')}</option>
                                {devices.map((device) => (
                                    <option key={device.deviceId} value={device.deviceId}>
                                        {getDeviceDisplayName(device, (key) => t(key))}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : null}
                    <label className={styles.fromFilter}>
                        <span>{t('history.from')}</span>
                        <input
                            type="date"
                            value={form.from}
                            max={form.to || undefined}
                            aria-invalid={formError !== null}
                            aria-describedby={formError ? `${formId}-criteria-error` : undefined}
                            onChange={(event) => {
                                setForm((current) => ({
                                    ...current,
                                    from: event.target.value,
                                }));
                                setFormError(null);
                            }}
                        />
                    </label>
                    <label className={styles.toFilter}>
                        <span>{t('history.to')}</span>
                        <input
                            type="date"
                            value={form.to}
                            min={form.from || undefined}
                            aria-invalid={formError !== null}
                            aria-describedby={formError ? `${formId}-criteria-error` : undefined}
                            onChange={(event) => {
                                setForm((current) => ({ ...current, to: event.target.value }));
                                setFormError(null);
                            }}
                        />
                    </label>
                </div>
                <div className={styles.actions}>
                    <Button
                        variant="text"
                        type="button"
                        className={styles.clearAction}
                        data-search-action
                        onClick={handleClear}
                    >
                        {t('history.clearFilters')}
                    </Button>
                    <div className={styles.reloadAction}>
                        <Button
                            variant="outlined"
                            type="button"
                            className={styles.reloadButton}
                            data-search-action
                            aria-describedby={
                                reloadTooltip ? `${formId}-reload-tooltip` : undefined
                            }
                            onBlur={() => setReloadTooltip(false)}
                            onClick={handleReload}
                        >
                            {t('history.refresh')}
                        </Button>
                        {reloadTooltip ? (
                            <span
                                id={`${formId}-reload-tooltip`}
                                role="tooltip"
                                className={styles.tooltip}
                            >
                                {t('history.searchFilterRequired')}
                            </span>
                        ) : null}
                    </div>
                    <Button variant="filled" type="submit" className={styles.submitAction}>
                        {t('history.search')}
                    </Button>
                </div>
            </div>
            {appliedForm ? (
                <p className={styles.summary}>
                    {describeCriteria(
                        appliedForm,
                        devices,
                        (key) => t(key),
                        (key) => t(`history.${key}`),
                    )}
                </p>
            ) : null}
            {formError ? (
                <p id={`${formId}-criteria-error`} className={styles.validation} role="alert">
                    {t('history.invalidDateRange')}
                </p>
            ) : null}
        </form>
    );
}

function describeCriteria(
    criteria: ReturnType<typeof useHistoryFilters>['form'],
    devices: readonly HistoryDevice[],
    translate: (key: string) => string,
    historyTranslate: (key: string) => string,
): string {
    const parts: string[] = [];

    if (criteria.deviceId) {
        const device = devices.find((candidate) => candidate.deviceId === criteria.deviceId);
        parts.push(
            `${historyTranslate('device')}: ${device ? getDeviceDisplayName(device, translate) : criteria.deviceId}`,
        );
    }

    if (criteria.from) {
        parts.push(`${historyTranslate('from')}: ${criteria.from}`);
    }

    if (criteria.to) {
        parts.push(`${historyTranslate('to')}: ${criteria.to}`);
    }

    return `${historyTranslate('appliedCriteria')}: ${parts.join(' · ')}`;
}
