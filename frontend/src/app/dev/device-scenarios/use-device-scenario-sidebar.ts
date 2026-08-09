import type { DeviceScenarioAction } from '@smart-room/contracts/development';
import { useEffect, useMemo, useRef, useState } from 'react';

import { createDeviceScenarioClient } from './device-scenario-client';
import type { DeviceScenarioTarget } from './device-scenario-target';

export function useDeviceScenarioSidebar(target: DeviceScenarioTarget | undefined) {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const [actions, setActions] = useState<readonly DeviceScenarioAction[]>();
    const [loadError, setLoadError] = useState<string>();
    const client = useMemo(
        () => (target ? createDeviceScenarioClient(target.deviceId) : undefined),
        [target?.deviceId],
    );

    useEffect(() => {
        if (!target || !client) {
            return;
        }

        closeButtonRef.current?.focus();
        let isCurrent = true;
        setActions(undefined);
        setLoadError(undefined);
        const loadScenarios = client.getScenarios;

        if (!loadScenarios) {
            setLoadError(`Development scenarios are unavailable for ${target.deviceId}.`);

            return;
        }

        void loadScenarios()
            .then((result) => {
                if (isCurrent) {
                    setActions(result.scenarios.map((scenario) => scenario.action));
                }
            })
            .catch(() => {
                if (isCurrent) {
                    setLoadError(`Development scenarios are unavailable for ${target.deviceId}.`);
                }
            });

        return () => {
            isCurrent = false;
        };
    }, [client, target?.deviceId]);

    return { actions, client, closeButtonRef, loadError };
}
