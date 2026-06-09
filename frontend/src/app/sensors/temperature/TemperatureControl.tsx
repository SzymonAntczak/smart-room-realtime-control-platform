import { useEffect, useState } from 'react';
import { ControlCard } from '../../shared/ui/ControlCard';
import styles from './TemperatureControl.module.css';

interface TemperatureReading {
    sequence: number;
    sensorName: string;
    value: number;
    unit: 'celsius';
    recordedAt: string;
}

const readingPattern = [0, 0.2, 0.4, 0.1, -0.1, -0.3] as const;

export function TemperatureControl() {
    const [reading, setReading] = useState(() => createTemperatureReading(0));

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setReading((currentReading) => createTemperatureReading(currentReading.sequence + 1));
        }, 1000);

        return () => window.clearInterval(intervalId);
    }, []);

    return (
        <ControlCard
            eyebrow="Simulated realtime"
            title={reading.sensorName}
            status="Live"
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

function createTemperatureReading(sequence: number): TemperatureReading {
    const offset = readingPattern[sequence % readingPattern.length];

    return {
        sequence,
        sensorName: 'Desk Temperature',
        value: 22.1 + offset,
        unit: 'celsius',
        recordedAt: new Date().toISOString(),
    };
}

function formatReadingTime(recordedAt: string) {
    return `${recordedAt.slice(11, 19)} UTC`;
}
