import { useEffect, useState } from 'react';
import { ControlCard } from '../../shared/ui/ControlCard';
import styles from './TemperatureControl.module.css';
import {
    connectTemperatureRealtime,
    type TemperatureSensorReading,
    type TemperatureSnapshotResult,
} from './room-realtime-client';

type TemperatureControlState =
    | {
          status: 'connecting';
      }
    | {
          status: 'ready';
          reading: TemperatureSensorReading;
          connectionStatus: 'connected' | 'disconnected';
      }
    | {
          status: 'empty';
          connectionStatus: 'connected' | 'disconnected';
      }
    | {
          status: 'error';
          message: string;
      };

export function TemperatureControl() {
    const [controlState, setControlState] = useState<TemperatureControlState>({
        status: 'connecting',
    });

    useEffect(() => {
        const connection = connectTemperatureRealtime({
            onOpen() {
                setControlState((currentState) => {
                    if (currentState.status === 'ready' || currentState.status === 'empty') {
                        return withConnectionStatus(currentState, 'connected');
                    }

                    return currentState;
                });
            },
            onSnapshot(snapshot) {
                setControlState(toConnectedControlState(snapshot));
            },
            onError() {
                setControlState((currentState) => {
                    if (currentState.status === 'ready' || currentState.status === 'empty') {
                        return withConnectionStatus(currentState, 'disconnected');
                    }

                    return {
                        status: 'error',
                        message:
                            'Realtime room stream is unavailable. Start the backend and refresh the page.',
                    };
                });
            },
            onClose() {
                setControlState((currentState) => {
                    if (currentState.status === 'ready' || currentState.status === 'empty') {
                        return withConnectionStatus(currentState, 'disconnected');
                    }

                    return {
                        status: 'error',
                        message:
                            'Realtime room stream disconnected before a snapshot was received.',
                    };
                });
            },
            onInvalidMessage() {
                setControlState({
                    status: 'error',
                    message: 'Realtime room stream sent an invalid snapshot.',
                });
            },
        });

        return () => {
            connection.close();
        };
    }, []);

    if (controlState.status === 'connecting') {
        return (
            <ControlCard
                eyebrow="Realtime room stream"
                title="Desk Temperature"
                status="Connecting"
                titleId="sensor-heading"
            >
                <p className={styles.message}>Connecting to realtime room stream...</p>
            </ControlCard>
        );
    }

    if (controlState.status === 'error') {
        return (
            <ControlCard
                eyebrow="Realtime room stream"
                title="Desk Temperature"
                status="Unavailable"
                titleId="sensor-heading"
            >
                <p className={styles.message} role="alert">
                    {controlState.message}
                </p>
            </ControlCard>
        );
    }

    if (controlState.status === 'empty') {
        return (
            <ControlCard
                eyebrow="Realtime room stream"
                title="Desk Temperature"
                status="No reading"
                titleId="sensor-heading"
            >
                {controlState.connectionStatus === 'disconnected' ? (
                    <p className={styles.warning} role="alert">
                        Realtime stream disconnected. Showing the last room state.
                    </p>
                ) : null}
                <p className={styles.message}>No temperature reading is available yet.</p>
            </ControlCard>
        );
    }

    const { reading } = controlState;

    return (
        <ControlCard
            eyebrow="Realtime room stream"
            title={reading.sensorName}
            status={formatHealth(reading.health)}
            titleId="sensor-heading"
        >
            {controlState.connectionStatus === 'disconnected' ? (
                <p className={styles.warning} role="alert">
                    Realtime stream disconnected. Showing the last temperature snapshot.
                </p>
            ) : null}
            <div className={styles.reading} aria-label="Current temperature">
                <span className={styles.value}>{reading.value.toFixed(1)}</span>
                <span className={styles.unit}>{reading.unit}</span>
            </div>

            <p className={styles.updated}>
                Last reading{' '}
                <time dateTime={reading.recordedAt}>{formatReadingTime(reading.recordedAt)}</time>
            </p>
        </ControlCard>
    );
}

function toConnectedControlState(snapshot: TemperatureSnapshotResult): TemperatureControlState {
    if (snapshot.status === 'empty') {
        return {
            status: 'empty',
            connectionStatus: 'connected',
        };
    }

    return {
        status: 'ready',
        reading: snapshot.reading,
        connectionStatus: 'connected',
    };
}

function withConnectionStatus(
    state: Extract<TemperatureControlState, { status: 'ready' | 'empty' }>,
    connectionStatus: 'connected' | 'disconnected',
): TemperatureControlState {
    return {
        ...state,
        connectionStatus,
    };
}

function formatReadingTime(recordedAt: string): string {
    return `${recordedAt.slice(11, 19)} UTC`;
}

function formatHealth(health: TemperatureSensorReading['health']): string {
    if (health === 'online') {
        return 'Online';
    }

    if (health === 'stale') {
        return 'Stale';
    }

    if (health === 'offline') {
        return 'Offline';
    }

    return 'Degraded';
}
