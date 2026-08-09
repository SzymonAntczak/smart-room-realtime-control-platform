import { useState } from 'react';

import { submitLedPowerCommand } from './led-command-client';

export function useLedCommandRequest(deviceId: string | undefined) {
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
            setTransportError('Unable to send the LED command. Please try again.');
        } finally {
            setSubmitting(false);
        }
    }

    return { requestPower, submitting, transportError };
}
