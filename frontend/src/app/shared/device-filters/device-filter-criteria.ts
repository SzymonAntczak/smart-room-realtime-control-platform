export interface DeviceFilterCriteria {
    deviceId?: string;
    from?: string;
    to?: string;
}

/** Calendar days are inclusive in the browser zone, not fixed 24-hour periods. */
export function toDeviceFilterCriteria(form: {
    deviceId: string;
    from: string;
    to: string;
}): DeviceFilterCriteria | null {
    if (!form.deviceId && !form.from && !form.to) {
        return null;
    }

    function dayStart(day: string, next = false) {
        const [year, month, date] = day.split('-').map(Number);

        return new Date(year, month - 1, date + (next ? 1 : 0)).toISOString();
    }

    return {
        ...(form.deviceId ? { deviceId: form.deviceId } : {}),
        ...(form.from ? { from: dayStart(form.from) } : {}),
        ...(form.to ? { to: dayStart(form.to, true) } : {}),
    };
}
