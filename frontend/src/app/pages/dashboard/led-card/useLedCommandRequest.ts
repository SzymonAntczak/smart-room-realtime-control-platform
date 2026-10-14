import type {
    AcceptedCommandResponse,
    ActiveCommandProjection,
    RejectedCommandResponse,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { submitLedPowerCommand } from '../../../api/commands';

interface RequestState {
    deviceId: string | undefined;
    submitting: boolean;
    consumedByProjection: boolean;
    requestToken?: object;
    recentCommandIdsAtResult?: readonly string[];
    admission?: AcceptedCommandResponse | RejectedCommandResponse;
    transportError?: string;
}

export function useLedCommandRequest(
    deviceId: string | undefined,
    activeCommand?: ActiveCommandProjection,
    recentCommands: readonly TerminalCommandProjection[] = [],
) {
    const { t } = useTranslation('dashboard');
    const inFlight = useRef<{ deviceId: string } | undefined>(undefined);
    const latestRecentCommandIds = useRef<readonly string[]>([]);
    const [state, setState] = useState<RequestState>({
        deviceId,
        submitting: false,
        consumedByProjection: false,
    });
    useEffect(() => {
        if (inFlight.current?.deviceId !== deviceId) {
            inFlight.current = undefined;
        }
    }, [deviceId]);
    const current: RequestState =
        state.deviceId === deviceId
            ? state
            : { deviceId, submitting: false, consumedByProjection: false };
    const admission = current.admission;
    const recentCommandIds = recentCommands.map(({ commandId }) => commandId);
    const correlatedCommand = admission
        ? activeCommand?.commandId === admission.commandId
            ? activeCommand
            : recentCommands.find((command) => command.commandId === admission.commandId)
        : undefined;
    const localFailure = current.transportError !== undefined || admission?.status === 'rejected';
    const newerTerminalCommand =
        localFailure &&
        recentCommands.some(
            (command) =>
                command.commandId !== admission?.commandId &&
                !current.recentCommandIdsAtResult?.includes(command.commandId),
        );

    useEffect(() => {
        latestRecentCommandIds.current = recentCommandIds;
    }, [recentCommandIds]);

    // SSE takes precedence immediately; consuming admission is sticky even if
    // the matching projection later leaves the bounded recent-command cache.
    if (state.deviceId !== deviceId) {
        setState(current);
    } else if (correlatedCommand && !state.consumedByProjection) {
        setState({ ...state, consumedByProjection: true });
    }

    async function requestPower(power: 'on' | 'off'): Promise<void> {
        if (!deviceId || inFlight.current?.deviceId === deviceId) {
            return;
        }

        const requestToken = { deviceId };
        inFlight.current = requestToken;
        setState({
            deviceId,
            requestToken,
            submitting: true,
            consumedByProjection: false,
        });

        try {
            const result = await submitLedPowerCommand({
                deviceId,
                commandType: 'set.power',
                requestedState: { power },
            });
            setState((latest) =>
                latest.requestToken !== requestToken
                    ? latest
                    : {
                          ...latest,
                          ...('error' in result
                              ? {
                                    transportError: result.message,
                                    recentCommandIdsAtResult: latestRecentCommandIds.current,
                                }
                              : {
                                    admission: result,
                                    recentCommandIdsAtResult: latestRecentCommandIds.current,
                                }),
                      },
            );
        } catch {
            setState((latest) =>
                latest.requestToken !== requestToken
                    ? latest
                    : {
                          ...latest,
                          transportError: t('led.commandRequestFailed'),
                          recentCommandIdsAtResult: latestRecentCommandIds.current,
                      },
            );
        } finally {
            if (inFlight.current === requestToken) {
                inFlight.current = undefined;
            }

            setState((latest) =>
                latest.requestToken !== requestToken
                    ? latest
                    : {
                          ...latest,
                          submitting: false,
                      },
            );
        }
    }

    return {
        requestPower,
        submitting: current.submitting,
        transportError: newerTerminalCommand ? undefined : current.transportError,
        admissionEvidence:
            !newerTerminalCommand && !correlatedCommand && !current.consumedByProjection
                ? admission
                : undefined,
        correlatedCommand,
    };
}
