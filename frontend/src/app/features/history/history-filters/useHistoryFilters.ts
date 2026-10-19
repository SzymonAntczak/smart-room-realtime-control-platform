import { type FormEvent, useEffect, useId, useRef, useState } from 'react';

import { useHistoryContext } from '../history-context';
import type { HistorySearchCriteria } from '../history-feed/history-search-session';
interface SearchForm {
    deviceId: string;
    from: string;
    to: string;
}

const emptyForm: SearchForm = { deviceId: '', from: '', to: '' };

export function useHistoryFilters(deviceId: string | undefined) {
    const context = useHistoryContext();

    if (context.mode !== 'search') {
        throw new Error('HistoryFilters requires search mode');
    }

    const {
        devices,
        search: { search: runSearch, refresh, clear },
        setFixedDeviceId,
    } = context;
    const initialForm = deviceId ? { ...emptyForm, deviceId } : emptyForm;
    const appliedFormRef = useRef<SearchForm>(initialForm);
    const formId = useId();
    const [form, setForm] = useState<SearchForm>(initialForm);
    const [appliedForm, setAppliedForm] = useState<SearchForm | null>(
        deviceId ? initialForm : null,
    );
    const [formError, setFormError] = useState<'range' | null>(null);
    const [reloadTooltip, setReloadTooltip] = useState(false);

    useEffect(() => {
        setFixedDeviceId(deviceId ?? null);

        if (deviceId) {
            void runSearch({ deviceId });
        }
    }, [deviceId, runSearch, setFixedDeviceId]);
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

    function applyForm(nextForm: SearchForm) {
        if (nextForm.from && nextForm.to && nextForm.from > nextForm.to) {
            setFormError('range');

            return;
        }

        const criteria = toSearchCriteria({ ...nextForm, deviceId: deviceId ?? nextForm.deviceId });

        if (!criteria) {
            setFormError(null);

            return;
        }

        setFormError(null);

        const nextAppliedForm = { ...nextForm, deviceId: deviceId ?? nextForm.deviceId };
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
    }

    function handleClear() {
        setReloadTooltip(false);
        setForm(emptyForm);
        setFormError(null);
        const next = deviceId ? { ...emptyForm, deviceId } : null;
        appliedFormRef.current = next ?? emptyForm;
        setAppliedForm(next);

        if (deviceId) {
            void runSearch({ deviceId });
        } else {
            clear();
        }
    }

    return {
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
    };
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
