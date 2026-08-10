import type { DeviceScenarioAction } from '@smart-room/contracts/development';
import { useEffect, useMemo, useRef, useState } from 'react';

import { createDeviceScenarioClient } from './device-scenario-client';

export function useDevPanel(deviceId: string | undefined) {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const [actions, setActions] = useState<readonly DeviceScenarioAction[]>();
    const [loadError, setLoadError] = useState<string>();
    const client = useMemo(
        () => (deviceId ? createDeviceScenarioClient(deviceId) : undefined),
        [deviceId],
    );

    useEffect(() => {
        if (!deviceId || !client) {
            return;
        }

        closeButtonRef.current?.focus();
        let isCurrent = true;
        setActions(undefined);
        setLoadError(undefined);

        void client
            .getScenarios()
            .then((result) => {
                if (isCurrent) {
                    setActions(result.scenarios.map((scenario) => scenario.action));
                }
            })
            .catch(() => {
                if (isCurrent) {
                    setLoadError(`Development scenarios are unavailable for ${deviceId}.`);
                }
            });

        return () => {
            isCurrent = false;
        };
    }, [client, deviceId]);

    return { actions, client, closeButtonRef, loadError };
}
