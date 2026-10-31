import { expect, type Page, test } from '@playwright/test';
import { isRawTelemetryPage } from '@smart-room/contracts/history';
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

test.use({ timezoneId: 'Europe/Warsaw' });
const instant = '2026-10-26T12:00:00.000Z';

function sample(sequence: number) {
    return {
        ...createHistoryIdentityFixtures().telemetrySample,
        recordId: `rec:v1:sha256:${sequence.toString(16).padStart(64, '0')}`,
        storageSequence: sequence,
        occurredAt: new Date(Date.parse('2026-10-25T12:00:00Z') + sequence * 1000).toISOString(),
        value: sequence === 1001 ? 27.123456789 : 20 + sequence / 10000,
    };
}

function response(first = 1000, cursor: string | null = '100') {
    const offset = cursor === null ? 0 : Number(cursor);
    const items = Array.from({ length: Math.min(100, first - offset) }, (_, i) =>
        sample(first - offset - i),
    );
    const page = {
        ...createHistoryIdentityFixtures().rawTelemetryPage,
        historyGenerationId: 'mock-history-generation',
        throughSequence: 1001,
        retentionAsOf: instant,
        pageSize: 100,
        items,
        nextCursor: offset + items.length < first ? String(offset + items.length) : null,
    };
    expect(isRawTelemetryPage(page)).toBe(true);

    return page;
}

async function prepare(page: Page) {
    await page.clock.setFixedTime(new Date(instant));
    await resetMockRoom(page.request);
    const snapshot = createOnlineTemperatureRoomSnapshot();
    snapshot.platform.storage = {
        status: 'available',
        changedAt: snapshot.updatedAt,
        historyGenerationId: 'mock-history-generation',
        storedThroughSequence: 1000,
    };
    await setMockRoomSnapshot(page.request, snapshot);
    await configureMockHistory(page.request, { pages: [createHistoryPage([])] });
}

for (const width of [390, 1440]) {
    test(`pages through 1,000 static samples with bounded DOM and preserves live-chart independence at ${width}px`, async ({
        page,
    }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await prepare(page);
        let latest = 1000;
        const requests: URL[] = [];
        await page.route('**/room/history/telemetry?*', async (route) => {
            const url = new URL(route.request().url());
            requests.push(url);
            await route.fulfill({ json: response(latest, url.searchParams.get('cursor')) });
        });
        await page.goto('/device-details/temp-desk');
        const section = page.getByRole('region', { name: 'Lista pomiarów', exact: true });
        const list = page.getByRole('region', { name: 'Przewijana historia pomiarów urządzenia' });
        await expect(list.getByTestId(`telemetry-item-${sample(1000).recordId}`)).toBeVisible();
        await expect(page.getByRole('application')).toHaveAccessibleDescription(/20\.0801/);
        await expect(
            page.getByText(
                'Wyświetlono 200 najnowszych pomiarów. Starsze pomiary pozostają poza widokiem.',
                { exact: true },
            ),
        ).toBeVisible();
        expect(requests.filter((url) => url.searchParams.has('cursor'))).toHaveLength(1);
        const initialQuery = requests.find((url) => !url.searchParams.has('cursor'));

        for (let count = 200; count <= 1000; count += 100) {
            const before = requests.length;
            await list.focus();
            await list.press('End');
            await expect(
                list.getByTestId(`telemetry-item-${sample(1100 - count).recordId}`),
            ).toBeAttached();
            expect(requests).toHaveLength(before + 1);
        }

        await list.press('End');
        await expect(list.getByText('Koniec pomiarów w wybranym zakresie.')).toBeVisible();
        expect(await list.getByRole('listitem').count()).toBeLessThan(80);
        expect(
            requests.every(
                (url) =>
                    url.searchParams.get('from') === initialQuery?.searchParams.get('from') &&
                    url.searchParams.get('to') === initialQuery?.searchParams.get('to'),
            ),
        ).toBe(true);
        const baselineRequests = requests.length;
        const live = { ...sample(1001), value: 27.123456789 };
        await publishMockRoomUpdate(page.request, {
            ...createDeviceUpdatedMessage(0, createOnlineTemperatureDeviceProjection()),
            telemetrySample: live,
        });
        await expect(page.getByRole('application')).toHaveAccessibleDescription(/27\.123456789/);
        expect(requests).toHaveLength(baselineRequests);
        await expect(list.getByText('Koniec pomiarów w wybranym zakresie.')).toBeVisible();
        await list.press('Home');
        await expect(list.getByTestId(`telemetry-item-${sample(1000).recordId}`)).toBeVisible();
        await expect(list.getByTestId(`telemetry-item-${live.recordId}`)).toHaveCount(0);
        latest = 1001;
        await section.getByRole('button', { name: 'Odśwież wyniki', exact: true }).click();
        await expect(list.getByTestId(`telemetry-item-${live.recordId}`)).toBeVisible();
        await expect(list.getByText('Koniec pomiarów w wybranym zakresie.')).toHaveCount(0);
        expect(requests).toHaveLength(baselineRequests + 1);
        await page.screenshot({
            path: testInfo.outputPath(`telemetry-list-${width}.png`),
            fullPage: true,
        });
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
    });
}

test('applies inclusive DST days, refreshes applied criteria and clears without changing the chart or event history', async ({
    page,
}) => {
    await prepare(page);
    const requests: URL[] = [];
    await page.route('**/room/history/telemetry?*', async (route) => {
        requests.push(new URL(route.request().url()));
        await route.fulfill({ json: response(1, null) });
    });
    await page.goto('/device-details/temp-desk');
    const section = page.getByRole('region', { name: 'Lista pomiarów', exact: true });
    await expect(section.getByTestId(`telemetry-item-${sample(1).recordId}`)).toBeVisible();
    await expect(page.getByRole('application')).toHaveAccessibleDescription(/20\.0001/);
    const chart = page.getByRole('application');
    const description = await chart.getAttribute('aria-describedby');
    const before = requests.length;
    await section.getByLabel('Od', { exact: true }).fill('2026-10-25');
    await section.getByLabel('Do', { exact: true }).fill('2026-10-25');
    expect(requests).toHaveLength(before);
    await section.getByRole('button', { name: 'Szukaj', exact: true }).click();
    await expect.poll(() => requests.length).toBe(before + 1);
    expect(requests.at(-1)?.searchParams.get('from')).toBe('2026-10-24T22:00:00.000Z');
    expect(requests.at(-1)?.searchParams.get('to')).toBe('2026-10-25T23:00:00.000Z');
    await section.getByLabel('Od', { exact: true }).fill('2026-10-24');
    await section.getByRole('button', { name: 'Odśwież wyniki', exact: true }).click();
    await expect.poll(() => requests.length).toBe(before + 2);
    expect(requests.at(-1)?.searchParams.get('from')).toBe('2026-10-24T22:00:00.000Z');
    await section.getByRole('button', { name: 'Wyczyść filtry' }).click();
    await expect.poll(() => requests.length).toBe(before + 3);
    expect(requests.at(-1)?.searchParams.get('from')).toBe('2026-09-26T12:00:00.000Z');
    await expect(section.getByLabel('Od', { exact: true })).toHaveValue('');
    await expect(chart).toHaveAttribute('aria-describedby', description ?? '');
    await expect(
        page
            .getByRole('region', { name: 'Historia zdarzeń urządzenia', exact: true })
            .getByLabel('Od', { exact: true }),
    ).toHaveValue('');
});

test('requires explicit refresh after cursor expiry and never automatically refetches', async ({
    page,
}) => {
    await prepare(page);
    let requests = 0;
    let expire = false;
    await page.route('**/room/history/telemetry?*', async (route) => {
        requests += 1;
        const cursor = new URL(route.request().url()).searchParams.get('cursor');
        await route.fulfill(
            cursor && expire
                ? { status: 400, json: { error: 'cursor_expired', message: 'Expired' } }
                : { json: response(1000, cursor) },
        );
    });
    await page.goto('/device-details/temp-desk');
    const list = page.getByRole('region', { name: 'Przewijana historia pomiarów urządzenia' });
    await expect(list.getByTestId(`telemetry-item-${sample(1000).recordId}`)).toBeVisible();
    // Wait for the independent chart baseline before expiring the static cursor.
    await expect(page.getByRole('application')).toHaveAccessibleDescription(/20\.0801/);
    const initialRequests = requests;
    expire = true;
    await list.focus();
    await list.press('End');
    await expect(list.getByRole('alert')).toContainText('Sesja pomiarów wygasła');
    expect(requests).toBe(initialRequests + 1);
    await list.getByRole('button', { name: 'Odśwież wyniki', exact: true }).click();
    await expect(list.getByRole('alert')).toHaveCount(0);
    expect(requests).toBe(initialRequests + 2);
});
