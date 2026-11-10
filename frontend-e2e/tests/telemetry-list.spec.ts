import { expect, type Locator, type Page, test } from '@playwright/test';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';

import {
    configureMockHistory,
    configureMockTelemetryHistory,
    isMockTelemetryResponseHeld,
    observeTelemetryHistoryRequests,
    publishMockRoomUpdate,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import {
    createDeviceUpdatedMessage,
    createOnlineTemperatureDeviceProjection,
    createOnlineTemperatureRoomSnapshot,
    createPlatformUpdatedMessage,
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

function telemetryPages(latest: number) {
    const fixture = createHistoryIdentityFixtures().rawTelemetryPage;

    return Array.from({ length: Math.ceil(latest / 100) }, (_, index) => {
        const offset = index * 100;
        const count = Math.min(100, latest - offset);

        return {
            ...fixture,
            historyGenerationId: 'mock-history-generation',
            throughSequence: latest,
            retentionAsOf: instant,
            pageSize: 100,
            items: Array.from({ length: count }, (_, i) => sample(latest - offset - i)),
            nextCursor: offset + count < latest ? `measurements-${index + 1}` : null,
        };
    });
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

async function revealMeasurement(list: Locator, sequence: number) {
    const item = list.getByTestId(`telemetry-item-${sample(sequence).recordId}`);
    const position = 1001 - sequence;
    await expect
        .poll(async () => {
            if (await item.count()) {
                return true;
            }

            const firstPosition = Number(
                await list.getByRole('listitem').first().getAttribute('aria-posinset'),
            );
            await list.evaluate(
                (element, direction) =>
                    element.scrollBy({
                        top: direction * element.clientHeight * 0.5,
                        behavior: 'instant',
                    }),
                firstPosition > position ? -1 : 1,
            );

            return false;
        })
        .toBe(true);
    await item.scrollIntoViewIfNeeded();
    await expect(item).toHaveRole('listitem');
    await expect(item).toBeVisible();
}

for (const width of [390, 1440]) {
    test(`pages through 1,000 static samples with bounded DOM and preserves live-chart independence at ${width}px`, async ({
        page,
    }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await prepare(page);
        await configureMockTelemetryHistory(page.request, { pages: telemetryPages(1000) });
        const requests = observeTelemetryHistoryRequests(page);
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
            await configureMockTelemetryHistory(page.request, { hold: true });

            try {
                await list.focus();
                await list.press('End');
                await expect.poll(() => requests.length).toBe(before + 1);
                await expect.poll(() => isMockTelemetryResponseHeld(page.request)).toBe(true);
                const loading = list.getByRole('status').filter({ hasText: /Ładowanie/u });
                await expect(loading).toBeVisible();
                // Finish the native scroll against the old page before appending new rows.
                await expect(
                    list.getByTestId(`telemetry-item-${sample(1101 - count).recordId}`),
                ).toBeVisible();
                await configureMockTelemetryHistory(page.request, { release: true });
                await expect(loading).toHaveCount(0);
                // Virtualized rows may be recycled; navigate to the record being checked.
                await revealMeasurement(list, 1100 - count);
                expect(requests).toHaveLength(before + 1);
            } finally {
                await configureMockTelemetryHistory(page.request, { release: true });
            }
        }

        await list.press('End');
        await expect(list.getByText('Koniec pomiarów w wybranym zakresie.')).toBeVisible();
        const oldest = list.getByTestId(`telemetry-item-${sample(1).recordId}`);
        await expect(oldest).toBeVisible();
        await expect(oldest).toHaveAttribute('aria-setsize', '1000');
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
            ...createDeviceUpdatedMessage(0, {
                ...createOnlineTemperatureDeviceProjection(),
                reportedState: { temperature: live.value, temperatureUnit: 'celsius' },
                observationStatus: {
                    temperature: {
                        freshness: 'fresh',
                        lastObservedAt: live.occurredAt,
                        durability: 'durable',
                    },
                },
            }),
            telemetrySample: live,
        });
        await publishMockRoomUpdate(
            page.request,
            createPlatformUpdatedMessage(1, live.storageSequence, live.occurredAt),
        );
        await expect(page.getByRole('application')).toHaveAccessibleDescription(/27\.123456789/);
        expect(requests).toHaveLength(baselineRequests);
        await expect(list.getByText('Koniec pomiarów w wybranym zakresie.')).toBeVisible();
        await list.press('Home');
        await expect(list.getByTestId(`telemetry-item-${sample(1000).recordId}`)).toBeVisible();
        await expect(list.getByTestId(`telemetry-item-${live.recordId}`)).toHaveCount(0);
        await configureMockTelemetryHistory(page.request, { pages: telemetryPages(1001) });
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
    await configureMockTelemetryHistory(page.request, { pages: telemetryPages(1) });
    const requests = observeTelemetryHistoryRequests(page);
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
    await configureMockTelemetryHistory(page.request, { pages: telemetryPages(1000) });
    const requests = observeTelemetryHistoryRequests(page);
    await page.goto('/device-details/temp-desk');
    const list = page.getByRole('region', { name: 'Przewijana historia pomiarów urządzenia' });
    await expect(list.getByTestId(`telemetry-item-${sample(1000).recordId}`)).toBeVisible();
    // Wait for the independent chart baseline before expiring the static cursor.
    await expect(page.getByRole('application')).toHaveAccessibleDescription(/20\.0801/);
    const initialRequests = requests.length;
    await configureMockTelemetryHistory(page.request, {
        error: { error: 'cursor_expired', message: 'Expired' },
    });
    await list.focus();
    await list.press('End');
    await expect(list.getByRole('alert')).toContainText('Sesja pomiarów wygasła');
    expect(requests).toHaveLength(initialRequests + 1);
    expect(requests.at(-1)?.searchParams.get('cursor')).toBe('measurements-1');
    await list.getByRole('button', { name: 'Odśwież wyniki', exact: true }).click();
    await expect(list.getByRole('alert')).toHaveCount(0);
    expect(requests).toHaveLength(initialRequests + 2);
    expect(requests.at(-1)?.searchParams.has('cursor')).toBe(false);
});
