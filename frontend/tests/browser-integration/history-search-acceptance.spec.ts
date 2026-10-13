import { expect, test } from '@playwright/test';

import {
    configureMockHistory,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import { createOnlineLedRoomSnapshot } from './mock-bff/mock-bff-fixtures';
import { createHistoryItems, createHistoryPage } from './mock-bff/recent-feed-fixtures';
import { historyEntry, openHistory } from './page-objects/history';

test.use({ timezoneId: 'Europe/Warsaw' });

test.beforeEach(async ({ page }) => {
    await resetMockRoom(page.request);
    const snapshot = createOnlineLedRoomSnapshot();
    snapshot.platform.storage = {
        ...snapshot.platform.storage,
        status: 'available',
        historyGenerationId: 'mock-history-generation',
        storedThroughSequence: 10000,
    };
    await setMockRoomSnapshot(page.request, snapshot);
});

for (const scenario of [
    {
        name: 'a 23-hour spring daylight-saving day',
        from: '2026-03-29',
        to: '2026-03-29',
        lower: '2026-03-28T23:00:00Z',
        upper: '2026-03-29T22:00:00Z',
        includedIndices: [1, 2],
    },
    {
        name: 'a 25-hour autumn daylight-saving day',
        from: '2026-10-25',
        to: '2026-10-25',
        lower: '2026-10-24T22:00:00Z',
        upper: '2026-10-25T23:00:00Z',
        includedIndices: [1, 2],
    },
    {
        name: 'only an inclusive local From day',
        from: '2026-03-29',
        to: '',
        lower: '2026-03-28T23:00:00Z',
        upper: '2026-03-29T22:00:00Z',
        includedIndices: [0, 1, 2],
    },
    {
        name: 'only an inclusive local To day',
        from: '',
        to: '2026-10-25',
        lower: '2026-10-24T22:00:00Z',
        upper: '2026-10-25T23:00:00Z',
        includedIndices: [1, 2, 3],
    },
]) {
    test(`searches ${scenario.name} using browser-local calendar boundaries`, async ({ page }) => {
        const times = [
            scenario.upper,
            new Date(Date.parse(scenario.upper) - 1).toISOString(),
            scenario.lower,
            new Date(Date.parse(scenario.lower) - 1).toISOString(),
        ];
        const records = createHistoryItems(4).map((item, index) => ({
            ...item,
            occurredAt: new Date(times[index] ?? '').toISOString(),
        }));
        await configureMockHistory(page.request, { pages: [createHistoryPage(records)] });
        await openHistory(page);
        await page.getByRole('button', { name: 'Szukaj', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Od', { exact: true }).fill(scenario.from);
        await dialog.getByLabel('Do', { exact: true }).fill(scenario.to);
        const searchRequest = page.waitForRequest((request) => {
            const url = new URL(request.url());

            return (
                url.pathname === '/room/history/user-history' &&
                url.searchParams.has(scenario.from ? 'from' : 'to')
            );
        });
        await dialog.getByRole('button', { name: 'Szukaj', exact: true }).click();
        const url = new URL((await searchRequest).url());
        expect(url.searchParams.get('from')).toBe(scenario.from ? scenario.lower : null);
        expect(url.searchParams.get('to')).toBe(scenario.to ? scenario.upper : null);
        const results = dialog.getByRole('region', { name: 'Wyniki wyszukiwania historii' });
        await expect(results.getByRole('listitem')).toHaveCount(scenario.includedIndices.length);

        for (const [index, record] of records.entries()) {
            const entry = results.getByTestId(`history-item-${record.recordId}`);

            await expect(entry).toHaveCount(Number(scenario.includedIndices.includes(index)));
        }

        for (const index of scenario.includedIndices) {
            const entry = results.getByTestId(`history-item-${records[index]?.recordId}`);
            await expect(entry).toHaveRole('listitem');
            await expect(entry).toBeVisible();
        }
    });
}

for (const width of [1440, 390]) {
    test(`contains native keyboard focus and clears search without incidental reads at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 900 });
        const records = createHistoryItems(1);
        await configureMockHistory(page.request, { pages: [createHistoryPage(records)] });
        await openHistory(page);
        await expect(historyEntry(page, records[0]?.recordId ?? 'missing')).toBeVisible();
        const requests: string[] = [];
        page.on('request', (request) => {
            if (new URL(request.url()).pathname === '/room/history/user-history') {
                requests.push(request.url());
            }
        });
        const opener = page.getByRole('button', { name: 'Szukaj', exact: true });
        await opener.focus();
        await opener.press('Enter');
        const dialog = page.getByRole('dialog');
        const close = dialog.getByRole('button', { name: 'Zamknij wyszukiwanie historii' });
        const results = dialog.getByRole('region', { name: 'Wyniki wyszukiwania historii' });
        await expect(close).toBeFocused();
        await close.press('Tab');
        await expect(dialog.getByRole('combobox')).toBeFocused();

        // Native Chromium dialogs may include browser chrome in the Tab cycle.
        // No keyboard step may focus a control in the inert background document.
        for (const key of ['Tab', 'Shift+Tab']) {
            for (let step = 0; step < 20; step += 1) {
                await page.keyboard.press(key);
                expect(
                    await dialog.evaluate(
                        (element) =>
                            element.contains(document.activeElement) ||
                            document.activeElement === document.body,
                    ),
                ).toBe(true);
            }
        }

        await results.focus();
        await results.press('Shift+Tab');
        const submit = dialog.getByRole('button', { name: 'Szukaj', exact: true });
        await expect(submit).toBeFocused();
        await submit.press('Tab');
        await expect(results).toBeFocused();
        await submit.press('Enter');
        await expect(results.getByRole('status')).toBeVisible();
        const refresh = dialog.getByRole('button', { name: 'Odśwież wyniki', exact: true });
        await refresh.click();
        await expect(dialog.getByRole('tooltip')).toBeVisible();
        await refresh.press('Escape');
        await expect(dialog.getByRole('tooltip')).toHaveCount(0);
        await expect(dialog).toBeVisible();
        expect(requests).toHaveLength(0);

        const from = dialog.getByLabel('Od', { exact: true });
        const to = dialog.getByLabel('Do', { exact: true });
        await from.fill('2026-09-21');
        await to.fill('2026-09-20');
        await to.press('Tab');
        expect(requests).toHaveLength(0);
        await dialog.getByRole('button', { name: 'Szukaj', exact: true }).click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(from).toHaveAttribute('aria-invalid', 'true');
        await expect(to).toHaveAttribute('aria-invalid', 'true');
        expect(requests).toHaveLength(0);
        await dialog.getByRole('button', { name: 'Wyczyść filtry', exact: true }).click();
        await expect(from).toHaveValue('');
        await expect(to).toHaveValue('');
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        await dialog.getByRole('combobox').selectOption('led-main');
        await dialog.getByRole('button', { name: 'Szukaj', exact: true }).click();
        await expect(results.getByTestId(`history-item-${records[0]?.recordId}`)).toBeVisible();
        expect(requests).toHaveLength(1);

        await from.fill('2026-09-21');
        await to.fill('2026-09-22');
        await expect(results.getByRole('listitem')).toHaveCount(1);
        expect(requests).toHaveLength(1);
        await dialog.getByRole('button', { name: 'Wyczyść filtry', exact: true }).click();
        await expect(from).toHaveValue('');
        await expect(to).toHaveValue('');
        await expect(dialog.getByRole('combobox')).toHaveValue('');
        await expect(results.getByRole('listitem')).toHaveCount(0);
        await expect(results.getByRole('status')).toBeVisible();
        expect(requests).toHaveLength(1);

        await dialog.getByRole('combobox').selectOption('led-main');
        await dialog.getByRole('button', { name: 'Szukaj', exact: true }).click();
        await expect(results.getByRole('listitem')).toHaveCount(1);
        expect(requests).toHaveLength(2);
        await close.focus();
        await close.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
        await opener.press('Enter');
        await expect(close).toBeFocused();
        await expect(from).toHaveValue('');
        await expect(to).toHaveValue('');
        await expect(dialog.getByRole('combobox')).toHaveValue('');
        await expect(results.getByRole('listitem')).toHaveCount(0);
        await expect(results.getByRole('status')).toBeVisible();
        expect(requests).toHaveLength(2);
    });

    test(`keeps a thousand static search results reachable with bounded DOM at ${width}px`, async ({
        page,
    }) => {
        test.setTimeout(90000);
        await page.setViewportSize({ width, height: 900 });
        const records = createHistoryItems(1000);
        await configureMockHistory(page.request, {
            pages: Array.from({ length: 20 }, (_, index) =>
                createHistoryPage(
                    records.slice(index * 50, (index + 1) * 50),
                    index < 19 ? `search-range-${index + 1}` : null,
                ),
            ),
        });
        await openHistory(page);
        await page.getByRole('button', { name: 'Szukaj', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('combobox').selectOption('led-main');
        await dialog.getByRole('button', { name: 'Szukaj', exact: true }).click();
        const results = dialog.getByRole('region', { name: 'Wyniki wyszukiwania historii' });
        await expect(results.getByTestId(`history-item-${records[0]?.recordId}`)).toBeVisible();
        await results.focus();

        for (let index = 1; index < 20; index += 1) {
            await configureMockHistory(page.request, { hold: true });
            const pageResponse = page.waitForResponse((response) => {
                const url = new URL(response.url());

                return (
                    url.pathname === '/room/history/user-history' &&
                    url.searchParams.get('deviceId') === 'led-main' &&
                    url.searchParams.get('cursor') === `search-range-${index}`
                );
            });
            await results.press('End');
            const loading = results.getByRole('status').filter({ hasText: /Ładowanie/ });
            await expect(loading).toBeVisible();
            await configureMockHistory(page.request, { release: true });
            await pageResponse;
            await expect(loading).toHaveCount(0);
            await expect.poll(() => results.getByRole('listitem').count()).toBeLessThan(40);
        }

        await results.focus();
        await results.press('End');
        const oldest = results.getByTestId(`history-item-${records[999]?.recordId}`);
        await expect(oldest).toBeVisible();
        await expect(oldest).toHaveRole('listitem');
        await expect(oldest).toHaveAttribute('aria-posinset', '1000');
        await expect(oldest).toHaveAttribute('aria-setsize', '1000');
        await expect.poll(() => results.getByRole('listitem').count()).toBeLessThan(40);
        await expect(
            dialog.getByRole('button', { name: 'Wczytaj starsze', exact: true }),
        ).toHaveCount(0);
        await results.press('Home');
        await expect(results.getByTestId(`history-item-${records[0]?.recordId}`)).toBeVisible();
        await expect(results).toBeFocused();
        await expect.poll(() => results.getByRole('listitem').count()).toBeLessThan(40);
    });
}
