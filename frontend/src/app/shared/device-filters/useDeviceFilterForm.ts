import { type FormEvent, useEffect, useId, useRef, useState } from 'react';

import { type DeviceFilterCriteria, toDeviceFilterCriteria } from './device-filter-criteria';
interface SearchForm {
    deviceId: string;
    from: string;
    to: string;
}

const emptyForm: SearchForm = { deviceId: '', from: '', to: '' };

export function useDeviceFilterForm({
    devices,
    fixedDeviceId: deviceId,
    onApply: runSearch,
    onRefresh: refresh,
    onClear: clear,
    validate,
}: {
    devices: readonly { deviceId: string; name: string }[];
    fixedDeviceId?: string;
    onApply(criteria: DeviceFilterCriteria): void;
    onRefresh(): void;
    onClear(): void;
    validate?(criteria: DeviceFilterCriteria): boolean;
}) {
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

        const criteria = toDeviceFilterCriteria({
            ...nextForm,
            deviceId: deviceId ?? nextForm.deviceId,
        });

        if (criteria && validate && !validate(criteria)) {
            setFormError('range');

            return;
        }

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
        const criteria = toDeviceFilterCriteria(appliedFormRef.current);

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

        clear();
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
