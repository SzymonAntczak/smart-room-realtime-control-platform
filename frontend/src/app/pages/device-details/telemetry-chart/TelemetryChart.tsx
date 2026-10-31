import type { LiveTelemetrySampleProjection } from '@smart-room/contracts/history';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import { formatTimestamp } from '../../../shared/date-time';

import { TelemetryTooltip } from './telemetry-tooltip/TelemetryTooltip';
import styles from './TelemetryChart.module.css';

export function TelemetryChart({ samples }: { samples: readonly LiveTelemetrySampleProjection[] }) {
    const { t } = useTranslation('deviceDetails');
    const descriptionId = useId();
    const data = samples.map((sample) => ({ ...sample, timestamp: Date.parse(sample.occurredAt) }));
    const dates = data.map((sample) => sample.timestamp);
    const values = data.map((sample) => sample.value);
    const minimumDate = dates.length ? Math.min(...dates) : 0;
    const maximumDate = dates.length ? Math.max(...dates) : 0;
    const minimumValue = values.length ? Math.min(...values) : 0;
    const maximumValue = values.length ? Math.max(...values) : 0;
    const timePadding = minimumDate === maximumDate ? 1000 : 0;
    const valuePadding = minimumValue === maximumValue ? 0.5 : 0;

    return (
        <figure className={styles.figure}>
            <p id={descriptionId} className={styles.description}>
                {samples.length === 0
                    ? t('chart.empty')
                    : t('chart.description', {
                          points: samples
                              .map(
                                  (sample) =>
                                      `${formatTimestamp(sample.occurredAt)}: ${sample.value}${sample.durability === 'volatile' ? ` (${t('telemetry.durability.volatile')})` : ''}`,
                              )
                              .join('; '),
                          unit: t('temperatureUnit'),
                      })}
            </p>
            <div className={styles.chart}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart
                        data={data}
                        accessibilityLayer
                        role="application"
                        aria-label={t('chart.title')}
                        aria-describedby={descriptionId}
                        margin={{ top: 16, right: 24, bottom: 12, left: 12 }}
                    >
                        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                        <XAxis
                            dataKey="timestamp"
                            type="number"
                            domain={[minimumDate - timePadding, maximumDate + timePadding]}
                            tickFormatter={(value: number) =>
                                formatTimestamp(new Date(value).toISOString())
                            }
                            minTickGap={24}
                            height={64}
                            tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
                            stroke="var(--color-border-strong)"
                            label={{
                                value: t('chart.timeAxis'),
                                position: 'insideBottom',
                                fill: 'var(--color-text-muted)',
                            }}
                            hide={samples.length === 0}
                        />
                        <YAxis
                            domain={[minimumValue - valuePadding, maximumValue + valuePadding]}
                            width={56}
                            tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
                            stroke="var(--color-border-strong)"
                            label={{
                                value: t('chart.temperatureAxis', { unit: t('temperatureUnit') }),
                                angle: -90,
                                position: 'insideLeft',
                                fill: 'var(--color-text-muted)',
                            }}
                            hide={samples.length === 0}
                        />
                        <Tooltip
                            isAnimationActive={false}
                            wrapperStyle={{ pointerEvents: 'auto' }}
                            content={({ active, label }) => (
                                <TelemetryTooltip
                                    samples={
                                        active && typeof label === 'number'
                                            ? samples.filter(
                                                  (sample) =>
                                                      Date.parse(sample.occurredAt) === label,
                                              )
                                            : []
                                    }
                                />
                            )}
                        />
                        <Line
                            dataKey="value"
                            type="linear"
                            stroke="var(--color-action-primary)"
                            strokeWidth={3}
                            dot={{
                                r: 4,
                                fill: 'var(--color-action-primary)',
                                stroke: 'var(--color-surface)',
                                strokeWidth: 2,
                            }}
                            activeDot={{ r: 5 }}
                            isAnimationActive={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
                {samples.length === 0 ? <p className={styles.empty}>{t('chart.empty')}</p> : null}
            </div>
        </figure>
    );
}
