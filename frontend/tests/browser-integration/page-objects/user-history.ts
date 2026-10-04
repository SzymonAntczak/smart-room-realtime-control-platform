import { expect, type Locator, type Page } from '@playwright/test';

export const historyHeading = 'Ostatnie istotne zdarzenia';
export const historyPanel = (page: Page) =>
    page.getByRole('complementary', { name: historyHeading });
export const historyEntry = (page: Page, id: string) => page.getByTestId(`history-item-${id}`);
export const historyEntries = (page: Page) =>
    page.getByRole('region', { name: historyHeading }).getByRole('listitem');

export async function openHistory(page: Page) {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: /ostatnie zdarzenia/i });
    await expect(toggle).toBeVisible();

    if ((await toggle.getAttribute('aria-expanded')) === 'false') {
        await toggle.click();
    }

    await expect(page.getByRole('region', { name: historyHeading })).toBeVisible();
}

export async function scrollToHistoryEntry(page: Page, id: string) {
    const entry = historyEntry(page, id);
    const root = historyPanel(page);
    await expect
        .poll(
            async () => {
                if (await entry.count()) {
                    return true;
                }

                await root.evaluate((element) =>
                    element.scrollBy({ top: element.clientHeight * 0.75, behavior: 'instant' }),
                );

                return false;
            },
            { timeout: 20000 },
        )
        .toBe(true);
    await expect(entry).toHaveRole('listitem');
    const navigation = await page.getByRole('group', { name: 'Nawigacja historii' }).boundingBox();
    const entryBox = await entry.boundingBox();
    const rootBox = await root.boundingBox();

    if (!navigation || !entryBox || !rootBox) {
        throw new Error('History reading geometry unavailable');
    }

    // Make this item the first unobscured row, rather than testing a row below the anchor.
    await root.evaluate(
        (element, delta) => {
            element.scrollTop += delta;
        },
        entryBox.y - rootBox.y - navigation.height - 1,
    );
    await expect(entry).toBeVisible();
    // Wait for measured layout to settle, without arbitrary time delays.
    let previous = Number.POSITIVE_INFINITY;
    await expect
        .poll(async () => {
            const value = await historyOffset(entry, root);
            const difference = Math.abs(value - previous);
            previous = value;

            return difference;
        })
        .toBeLessThanOrEqual(0.5);

    return entry;
}

export async function historyOffset(entry: Locator, root: Locator) {
    const entryBox = await entry.boundingBox();
    const rootBox = await root.boundingBox();

    if (!entryBox || !rootBox) {
        throw new Error('History geometry unavailable');
    }

    return entryBox.y - rootBox.y;
}
