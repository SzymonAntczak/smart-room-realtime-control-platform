import { X } from 'lucide-react';
import {
    type FormEvent,
    type MouseEvent,
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
} from 'react';
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
    const [formError, setFormError] = useState<'range' | null>(null);
    const [reloadTooltip, setReloadTooltip] = useState(false);
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

    useEffect(() => {
        if (!reloadTooltip) {
            return;
        }

        const hideTooltip = () => setReloadTooltip(false);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                hideTooltip();
            }
        };

        const timer = setTimeout(hideTooltip, 3000);

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            clearTimeout(timer);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [reloadTooltip]);

    function handleClose() {
        setReloadTooltip(false);
        appliedFormRef.current = emptyForm;
        setForm(emptyForm);
        setAppliedForm(null);
        setFormError(null);
        close();
        onClose();
    }

    function applyForm(nextForm: SearchForm) {
        if (nextForm.from && nextForm.to && nextForm.from > nextForm.to) {
            setFormError('range');

            return;
        }

        const criteria = toSearchCriteria(nextForm);

        if (!criteria) {
            setFormError(null);

            return;
        }

        setFormError(null);

        const nextAppliedForm = { ...nextForm };
        appliedFormRef.current = nextAppliedForm;
        setAppliedForm(nextAppliedForm);

        void runSearch(criteria);
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        applyForm(form);
    }

    function handleReload() {
        const criteria = toSearchCriteria(appliedFormRef.current);

        if (!criteria) {
            setReloadTooltip(true);

            return;
        }

        setReloadTooltip(false);
        void refresh();

        scrollParent?.scrollTo?.({ top: 0, behavior: 'auto' });
    }

    function handleDialogClick(event: MouseEvent<HTMLDialogElement>) {
        if (event.target !== event.currentTarget) {
            return;
        }

        const bounds = event.currentTarget.getBoundingClientRect();

        if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
        ) {
            event.currentTarget.close();
        }
    }

    function handleClear() {
        setReloadTooltip(false);
        appliedFormRef.current = emptyForm;
        setForm(emptyForm);
        setAppliedForm(null);
        setFormError(null);

        clear();
    }

    return (
        <dialog
            ref={dialogRef}
            className={styles.dialog}
            aria-labelledby={`${formId}-title`}
            onClose={handleClose}
            onClick={handleDialogClick}
        >
            <header className={styles.header}>
                <div>
                    <h2 id={`${formId}-title`}>{t('history.searchTitle')}</h2>
                </div>
                <button
                    ref={closeButtonRef}
                    type="button"
                    className={styles.iconButton}
                    data-search-action
                    aria-label={t('history.closeSearch')}
                    onClick={() => dialogRef.current?.close()}
                >
                    <X aria-hidden="true" size={20} />
                </button>
            </header>

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
                <div className={styles.controlLayout}>
                    <div className={styles.filters}>
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
                        <label className={styles.fromFilter}>
                            <span>{t('history.from')}</span>
                            <input
                                type="date"
                                value={form.from}
                                max={form.to || undefined}
                                aria-invalid={formError !== null}
                                aria-describedby={
                                    formError ? `${formId}-criteria-error` : undefined
                                }
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
                                aria-describedby={
                                    formError ? `${formId}-criteria-error` : undefined
                                }
                                onChange={(event) => {
                                    setForm((current) => ({ ...current, to: event.target.value }));
                                    setFormError(null);
                                }}
                            />
                        </label>
                    </div>
                    <div className={styles.actions}>
                        <button
                            type="button"
                            className={styles.clearAction}
                            data-search-action
                            onClick={handleClear}
                        >
                            {t('history.clearFilters')}
                        </button>
                        <div className={styles.reloadAction}>
                            <button
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
                            </button>
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
                        <button type="submit" className={styles.submitAction}>
                            {t('history.search')}
                        </button>
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

            <div
                className={styles.results}
                ref={attachScrollParent}
                role="region"
                aria-label={t('history.searchResults')}
                tabIndex={0}
            >
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
