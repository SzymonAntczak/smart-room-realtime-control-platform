import { useEffect, useState } from 'react';
import { ControlCard } from '../../shared/ui/ControlCard';
import styles from './TemperatureControl.module.css';
import { loadTemperatureSnapshot, type TemperatureSensorReading } from './room-snapshot-client';

type TemperatureControlState =
    | {
          status: 'loading';
      }
    | {
          status: 'ready';
          reading: TemperatureSensorReading;
      }
    | {
          status: 'empty';
      }
    | {
          status: 'error';
      };

export function TemperatureControl() {
    const [controlState, setControlState] = useState<TemperatureControlState>({
        status: 'loading',
    });

    useEffect(() => {
        let isActive = true;

        loadTemperatureSnapshot()
            .then((snapshot) => {
                if (!isActive) {
                    return;
                }

                setControlState(snapshot);
            })
            .catch(() => {
                if (!isActive) {
                    return;
                }

                setControlState({
                    status: 'error',
                });
            });

        return () => {
            isActive = false;
        };
    }, []);

    if (controlState.status === 'loading') {
        return (
            <ControlCard
                eyebrow="Backend snapshot"
                title="Desk Temperature"
                status="Loading"
                titleId="sensor-heading"
            >
                <p className={styles.message}>Loading room snapshot...</p>
            </ControlCard>
        );
    }

    if (controlState.status === 'error') {
        return (
            <ControlCard
                eyebrow="Backend snapshot"
                title="Desk Temperature"
                status="Unavailable"
                titleId="sensor-heading"
            >
                <p className={styles.message} role="alert">
                    Room snapshot is unavailable. Start the backend and refresh the page.
                </p>
            </ControlCard>
        );
    }

    if (controlState.status === 'empty') {
        return (
            <ControlCard
                eyebrow="Backend snapshot"
                title="Desk Temperature"
                status="No reading"
                titleId="sensor-heading"
            >
                <p className={styles.message}>No temperature reading is available yet.</p>
            </ControlCard>
        );
    }

    const { reading } = controlState;

    return (
        <ControlCard
            eyebrow="Backend snapshot"
            title={reading.sensorName}
            status={formatHealth(reading.health)}
            titleId="sensor-heading"
        >
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
