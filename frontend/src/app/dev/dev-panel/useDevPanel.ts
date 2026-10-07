import type { DeviceScenarioAction } from '@smart-room/contracts/development';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createDeviceScenarioClient } from './device-scenario-client';

export function useDevPanel(deviceId: string | undefined) {
    const { t } = useTranslation('development');
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const client = useMemo(
        () => (deviceId ? createDeviceScenarioClient(deviceId) : undefined),
        [deviceId],
    );
    const request = useMemo(() => ({ client, deviceId, t }), [client, deviceId, t]);
    const [loaded, setLoaded] = useState<{
        request: typeof request;
        actions?: readonly DeviceScenarioAction[];
        error?: string;
    }>();

    useEffect(() => {
        const { client, deviceId, t } = request;

        if (!deviceId || !client) {
            return;
        }

        closeButtonRef.current?.focus();
        let isCurrent = true;

        void client
            .getScenarios()
            .then((result) => {
                if (isCurrent) {
                    setLoaded({
                        request,
                        actions: result.scenarios.map((scenario) => scenario.action),
                    });
                }
            })
            .catch(() => {
                if (isCurrent) {
                    setLoaded({ request, error: t('scenariosUnavailable', { deviceId }) });
                }
            });

        return () => {
            isCurrent = false;
        };
    }, [request]);

    return {
        actions: loaded?.request === request ? loaded.actions : undefined,
        client,
        closeButtonRef,
        loadError: loaded?.request === request ? loaded.error : undefined,
    };
}
