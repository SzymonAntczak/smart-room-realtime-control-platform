import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { submitLedPowerCommand } from './led-command-client';

export function useLedCommandRequest(deviceId: string | undefined) {
    const { t } = useTranslation('dashboard');
    const [submitting, setSubmitting] = useState(false);
    const [transportError, setTransportError] = useState<string>();

    async function requestPower(power: 'on' | 'off'): Promise<void> {
        if (!deviceId) {
            return;
        }

        setSubmitting(true);
        setTransportError(undefined);

        try {
            const result = await submitLedPowerCommand({
                deviceId,
                commandType: 'set.power',
                requestedState: { power },
            });

            if (result.status === 'rejected') {
                setTransportError(result.message);
            }
        } catch {
            setTransportError(t('led.commandRequestFailed'));
        } finally {
            setSubmitting(false);
        }
    }

    return { requestPower, submitting, transportError };
}
