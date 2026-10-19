import type { RawTelemetrySampleProjection } from '@smart-room/contracts/history';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTimestamp } from '../../../features/date-time';

import styles from './TelemetryChart.module.css';

const plot = { left: 64, right: 704, top: 24, bottom: 164 };

export function TelemetryChart({ samples }: { samples: readonly RawTelemetrySampleProjection[] }) {
    const { t } = useTranslation('deviceDetails');
    const titleId = useId();
    const descriptionId = useId();
    const dates = samples.map((sample) => Date.parse(sample.occurredAt));
    const values = samples.map((sample) => sample.value);
    const minimumDate =
        dates.length > 0 ? dates.reduce((minimum, value) => Math.min(minimum, value), Infinity) : 0;
    const maximumDate =
        dates.length > 0
            ? dates.reduce((maximum, value) => Math.max(maximum, value), -Infinity)
            : 0;
    const minimumValue =
        values.length > 0
            ? values.reduce((minimum, value) => Math.min(minimum, value), Infinity)
            : 0;
    const maximumValue =
        values.length > 0
            ? values.reduce((maximum, value) => Math.max(maximum, value), -Infinity)
            : 0;
    const valuePadding = minimumValue === maximumValue ? 0.5 : 0;
    const valueRange = maximumValue - minimumValue + valuePadding * 2 || 1;
    const timeRange = maximumDate - minimumDate || 1;
    const points = samples.map((sample, index) => {
        const x =
            samples.length === 1
                ? (plot.left + plot.right) / 2
                : plot.left + ((dates[index] - minimumDate) / timeRange) * (plot.right - plot.left);
        const y =
            plot.bottom -
            ((sample.value - minimumValue + valuePadding) / valueRange) * (plot.bottom - plot.top);

        return `${x},${y}`;
    });

    return (
        <figure className={styles.figure}>
            <svg
                className={styles.chart}
                viewBox="0 0 740 210"
                role="img"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                focusable="false"
            >
                <title id={titleId}>{t('chart.title')}</title>
                <desc id={descriptionId}>
                    {samples.length === 0
                        ? t('chart.empty')
                        : t('chart.description', {
                              points: samples
                                  .map(
                                      (sample) =>
                                          `${formatTimestamp(sample.occurredAt)}: ${sample.value}`,
                                  )
                                  .join('; '),
                              unit: t('temperatureUnit'),
                          })}
                </desc>
                <line
                    className={styles.axis}
                    x1={plot.left}
                    y1={plot.top}
                    x2={plot.left}
                    y2={plot.bottom}
                />
                <line
                    className={styles.axis}
                    x1={plot.left}
                    y1={plot.bottom}
                    x2={plot.right}
                    y2={plot.bottom}
                />
                <text className={styles.axisLabel} x="384" y="202" textAnchor="middle">
                    {t('chart.timeAxis')}
                </text>
                <text
                    className={styles.axisLabel}
                    x="15"
                    y="94"
                    textAnchor="middle"
                    transform="rotate(-90 15 94)"
                >
                    {t('chart.temperatureAxis', { unit: t('temperatureUnit') })}
                </text>
                {points.length > 1 ? (
                    <polyline className={styles.line} points={points.join(' ')} />
                ) : null}
                {points.map((point, index) => {
                    const [cx, cy] = point.split(',').map(Number);

                    return (
                        <circle
                            key={samples[index].recordId}
                            className={styles.point}
                            cx={cx}
                            cy={cy}
                            r="4"
                        />
                    );
                })}
            </svg>
        </figure>
    );
}
