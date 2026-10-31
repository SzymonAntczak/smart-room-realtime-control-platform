import { expect, type Locator, type Page, test } from '@playwright/test';
import {
    isRawTelemetryPage,
    type RawTelemetrySampleProjection,
} from '@smart-room/contracts/history';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';

import {
    configureMockHistory,
    publishMockRoomUpdate,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import {
    createDeviceUpdatedMessage,
    createOnlineTemperatureDeviceProjection,
    createOnlineTemperatureRoomSnapshot,
} from './mock-bff/mock-bff-fixtures';
import { createHistoryPage } from './mock-bff/recent-feed-fixtures';

test.use({ timezoneId: 'UTC' });

async function bounds(locator: Locator) {
    const rectangle = await locator.boundingBox();

    if (!rectangle) {
        throw new Error('Expected a rendered chart element with measurable bounds.');
    }

    return rectangle;
}

function measurements(): RawTelemetrySampleProjection[] {
    const fixture = createHistoryIdentityFixtures().telemetrySample;

    return [0, 1000, 10000, 10000].map((offset, index) => ({
        ...fixture,
        recordId: `rec:v1:sha256:${String(index + 1).padStart(64, '0')}`,
        storageSequence: index + 8,
        occurredAt: new Date(Date.parse(fixture.occurredAt) + offset).toISOString(),
        value: [20, 21.125, 23, 24][index],
    }));
}

async function openTelemetry(page: Page, samples: RawTelemetrySampleProjection[]) {
    await page.clock.setFixedTime(new Date('2026-09-11T00:00:00.000Z'));
    await resetMockRoom(page.request);
    const snapshot = createOnlineTemperatureRoomSnapshot();
    snapshot.platform.storage = {
        status: 'available',
        changedAt: snapshot.updatedAt,
        historyGenerationId: 'mock-history-generation',
        storedThroughSequence: 11,
    };
    await setMockRoomSnapshot(page.request, snapshot);
    await configureMockHistory(page.request, { pages: [createHistoryPage([])] });
    const baseline = {
        ...createHistoryIdentityFixtures().rawTelemetryPage,
        historyGenerationId: 'mock-history-generation',
        throughSequence: 11,
        retentionAsOf: '2026-09-11T00:00:00.000Z',
        pageSize: 100,
        items: [...samples].reverse(),
        nextCursor: null,
    };
    expect(isRawTelemetryPage(baseline)).toBe(true);
    await page.route('**/room/history/telemetry?*', (route) => route.fulfill({ json: baseline }));
    await page.goto('/device-details/temp-desk');
    const list = page.getByRole('region', { name: 'Przewijana historia pomiarów urządzenia' });
    await expect(list.getByRole('listitem')).toHaveCount(samples.length);

    return page.getByRole('application');
}

for (const width of [390, 1440]) {
    test(`supports pointer, keyboard, tied timestamps and live updates at ${width}px`, async ({
        page,
    }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        const samples = measurements();
        const chart = await openTelemetry(page, samples);
        await expect(chart).toBeVisible();

        for (const sample of samples) {
            await expect(chart).toHaveAccessibleDescription(
                new RegExp(String(sample.value).replace('.', '\\.')),
            );
        }

        await page.getByRole('heading', { level: 1 }).focus();
        await page.keyboard.press('Tab');
        await expect(chart).toBeFocused();
        await expect(chart).toHaveCSS('outline-style', 'solid');
        const tooltip = page.getByRole('tooltip');
        await expect(tooltip).toContainText('20');
        await chart.press('ArrowRight');
        await expect(tooltip).toContainText('21.125');
        await chart.press('ArrowRight');
        await expect(tooltip.getByRole('listitem')).toHaveCount(2);
        await expect(tooltip.getByRole('listitem').nth(0)).toContainText('23');
        await expect(tooltip.getByRole('listitem').nth(1)).toContainText('24');
        await expect(tooltip).toContainText('10:00:10');
        await expect(tooltip).toContainText('2026');

        await page.screenshot({
            path: testInfo.outputPath(`telemetry-${width}.png`),
            fullPage: true,
        });
        const tooltipBounds = await bounds(tooltip);
        expect(tooltipBounds.x).toBeGreaterThanOrEqual(0);
        expect(tooltipBounds.x + tooltipBounds.width).toBeLessThanOrEqual(width);
        const device = createOnlineTemperatureDeviceProjection();
        const liveSample = {
            recordId: `rec:v1:sha256:${'e'.repeat(64)}`,
            durability: 'volatile' as const,
            deviceId: 'temp-desk',
            metric: 'temperature' as const,
            unit: 'celsius' as const,
            occurredAt: samples[3].occurredAt,
            value: 25.5,
        };
        const update = createDeviceUpdatedMessage(
            0,
            {
                ...device,
                reportedState: { temperature: liveSample.value, temperatureUnit: 'celsius' },
                observationStatus: {
                    temperature: {
                        freshness: 'fresh',
                        lastObservedAt: liveSample.occurredAt,
                        durability: 'volatile',
                    },
                },
            },
            undefined,
            '2026-09-11T00:00:01.000Z',
        );
        await publishMockRoomUpdate(page.request, { ...update, telemetrySample: liveSample });
        await expect(
            page
                .getByRole('region', { name: 'Przewijana historia pomiarów urządzenia' })
                .getByRole('listitem'),
        ).toHaveCount(samples.length);
        await expect(chart).toHaveAccessibleDescription(/25\.5 \(Nieutrwalone\)/);
        await expect(tooltip.getByRole('listitem')).toHaveCount(3);
        await chart.press('ArrowLeft');
        await expect(tooltip).toContainText('21.125');
        await chart.press('ArrowRight');
        await expect(tooltip.getByRole('listitem')).toHaveCount(3);
        await expect(tooltip.getByRole('listitem').last()).toContainText('25.5 °C');
        await expect(tooltip.getByRole('listitem').last()).toContainText('Nieutrwalone');

        await page.keyboard.press('Tab');
        await expect(chart).not.toBeFocused();
        // Hit observations through the chart's public interaction area.
        await chart.hover({ position: { x: 69, y: 40 } });
        await expect(tooltip.getByRole('listitem')).toHaveCount(1);
        await expect(tooltip).toContainText('20');
        await chart.hover({ position: { x: (await bounds(chart)).width - 25, y: 40 } });
        await expect(tooltip.getByRole('listitem')).toHaveCount(3);
        await expect(tooltip).toContainText('25.5 °C');

        const before = await chart.boundingBox();
        await page.setViewportSize({ width: width === 390 ? 1440 : 390, height: 1000 });
        await expect.poll(async () => (await chart.boundingBox())?.width).not.toBe(before?.width);
        const after = await chart.boundingBox();
        expect(after?.height).toBe(288);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
    });
}

for (const variant of ['single', 'flat'] as const) {
    const samples = measurements()
        .slice(0, variant === 'single' ? 1 : 2)
        .map((sample) => ({ ...sample, value: 22.5 }));

    test(`renders ${variant} measurements on a stable scale`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 390, height: 1000 });
        const chart = await openTelemetry(page, samples);
        await expect(chart).toBeVisible();
        await chart.focus();
        await expect(page.getByRole('tooltip')).toContainText('22.5 °C');
        await expect(chart).toHaveAccessibleDescription(/22\.5/);
        await page.screenshot({
            path: testInfo.outputPath(`telemetry-${variant}.png`),
            fullPage: true,
        });
    });
}

test('renders empty telemetry without inventing a measurement', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    const chart = await openTelemetry(page, []);
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAccessibleDescription(/Brak punktów/);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('telemetry-empty.png'), fullPage: true });
});
