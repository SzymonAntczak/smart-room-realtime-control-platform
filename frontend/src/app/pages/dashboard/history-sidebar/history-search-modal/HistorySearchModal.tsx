import { X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getDeviceDisplayName } from '../../device-display-name';
import type { RenderableDeviceProjection } from '../../device-projection';

import { HistorySearchResults } from './history-search-results/HistorySearchResults';
import type { HistorySearchCriteria } from './history-search-session';
import styles from './HistorySearchModal.module.css';
import { useHistorySearch } from './useHistorySearch';

interface SearchForm {
    deviceId: string;
    from: string;
    to: string;
}

const emptyForm: SearchForm = { deviceId: '', from: '', to: '' };

export function HistorySearchModal({
    open,
    onClose,
    devices,
}: {
    open: boolean;
    onClose(): void;
    devices: readonly RenderableDeviceProjection[];
}) {
    const { t } = useTranslation('dashboard');
    const dialogRef = useRef<HTMLDialogElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const {
        state: searchState,
        search: runSearch,
        loadOlder,
        retry,
        refresh,
        clear,
        start,
        close,
    } = useHistorySearch();
    const appliedFormRef = useRef<SearchForm>(emptyForm);
    const formId = useId();
    const [form, setForm] = useState<SearchForm>(emptyForm);
    const [appliedForm, setAppliedForm] = useState<SearchForm | null>(null);
    const [formError, setFormError] = useState<'required' | 'range' | null>(null);
    const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);
    const attachScrollParent = useCallback((element: HTMLDivElement | null) => {
        setScrollParent(element);
    }, []);

    useEffect(() => {
        const dialog = dialogRef.current;

        if (!dialog) {
            return;
        }

        if (open && !dialog.open) {
            start();
            dialog.showModal();
            closeButtonRef.current?.focus();
        } else if (!open && dialog.open) {
            dialog.close();
        }
    }, [open, start]);

    function handleClose() {
        setForm(appliedFormRef.current);
        close();
        onClose();
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (form.from && form.to && form.from > form.to) {
            setFormError('range');

            return;
        }

        const criteria = toSearchCriteria(form);

        if (!criteria) {
            setFormError('required');

            return;
        }

        setFormError(null);

        const nextAppliedForm = { ...form };
        appliedFormRef.current = nextAppliedForm;
        setAppliedForm(nextAppliedForm);

        void runSearch(criteria);
    }

    function handleClear() {
        appliedFormRef.current = emptyForm;
        setAppliedForm(null);
        setForm(emptyForm);
        setFormError(null);

        clear();
    }

    const summaryForm =
        searchState.lastKnown && searchState.displayedCriteria
            ? formFromCriteria(searchState.displayedCriteria)
            : appliedForm;

    return (
        <dialog
            ref={dialogRef}
            className={styles.dialog}
            aria-labelledby={`${formId}-title`}
            aria-describedby={`${formId}-description`}
            onClose={handleClose}
        >
            <header className={styles.header}>
                <div>
                    <h2 id={`${formId}-title`}>{t('history.searchTitle')}</h2>
                    <p id={`${formId}-description`}>{t('history.searchDescription')}</p>
                </div>
                <button
                    ref={closeButtonRef}
                    type="button"
                    className={styles.iconButton}
                    aria-label={t('history.closeSearch')}
                    onClick={() => dialogRef.current?.close()}
                >
                    <X aria-hidden="true" size={20} />
                </button>
            </header>

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
                <div className={styles.filters}>
                    <label>
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
                    <label>
                        <span>{t('history.from')}</span>
                        <input
                            type="date"
                            value={form.from}
                            max={form.to || undefined}
                            aria-invalid={formError !== null}
                            aria-describedby={formError ? `${formId}-criteria-error` : undefined}
                            onChange={(event) => {
                                setForm((current) => ({ ...current, from: event.target.value }));
                                setFormError(null);
                            }}
                        />
                    </label>
                    <label>
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
                {formError ? (
                    <p id={`${formId}-criteria-error`} className={styles.validation} role="alert">
                        {t(
                            formError === 'range'
                                ? 'history.invalidDateRange'
                                : 'history.searchRequired',
                        )}
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <button type="submit" className={styles.primaryButton}>
                        {t('history.search')}
                    </button>
                    <button type="button" onClick={handleClear}>
                        {t('history.clearFilters')}
                    </button>
                </div>
            </form>

            <div
                className={styles.results}
                ref={attachScrollParent}
                role="region"
                aria-label={t('history.searchResults')}
                tabIndex={0}
            >
                {summaryForm ? (
                    <p className={styles.summary} role="status">
                        {describeCriteria(
                            summaryForm,
                            devices,
                            (key) => t(key),
                            (key) => t(`history.${key}`),
                        )}
                    </p>
                ) : null}
                <HistorySearchResults
                    state={searchState}
                    devices={devices}
                    scrollParent={scrollParent}
                    loadOlder={loadOlder}
                    retry={retry}
                    refresh={refresh}
                />
            </div>
        </dialog>
    );
}

function toSearchCriteria(form: SearchForm): HistorySearchCriteria | null {
    if (!form.deviceId && !form.from && !form.to) {
        return null;
    }

    return {
        ...(form.deviceId ? { deviceId: form.deviceId } : {}),
        ...(form.from ? { from: localDayStart(form.from) } : {}),
        ...(form.to ? { to: nextLocalDayStart(form.to) } : {}),
    };
}

function localDayStart(day: string): string {
    const [year, month, date] = day.split('-').map(Number);

    return new Date(year, month - 1, date).toISOString();
}

function nextLocalDayStart(day: string): string {
    const [year, month, date] = day.split('-').map(Number);

    return new Date(year, month - 1, date + 1).toISOString();
}

function formFromCriteria(criteria: HistorySearchCriteria): SearchForm {
    return {
        deviceId: criteria.deviceId ?? '',
        from: criteria.from ? localDate(new Date(criteria.from)) : '',
        to: criteria.to ? localDate(new Date(new Date(criteria.to).getTime() - 1)) : '',
    };
}

function localDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function describeCriteria(
    criteria: SearchForm,
    devices: readonly RenderableDeviceProjection[],
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
