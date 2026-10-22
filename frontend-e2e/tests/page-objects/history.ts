import { expect, type Locator, type Page } from '@playwright/test';

export const historyPanel = (page: Page) =>
    page.getByRole('region', { name: 'Przewijana historia zdarzeń' });
export const historyEntry = (page: Page, id: string) => page.getByTestId(`history-item-${id}`);
export const historyEntries = (page: Page) => historyPanel(page).getByRole('listitem');

export async function openHistory(page: Page) {
    await page.goto('/');
    await expandHistory(page);
}

export async function expandHistory(page: Page) {
    const toggle = page.getByRole('button', { name: /ostatnie zdarzenia/i });
    await expect(toggle).toBeVisible();

    if ((await toggle.getAttribute('aria-expanded')) === 'false') {
        await toggle.click();
    }

    await expect(historyPanel(page)).toBeVisible();
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
    const entryBox = await entry.boundingBox();
    const rootBox = await root.boundingBox();

    if (!entryBox || !rootBox) {
        throw new Error('History reading geometry unavailable');
    }

    // Align the row with the scroll viewport's content edge.
    await root.evaluate(
        (element, delta) => {
            element.scrollTop += delta;
        },
        entryBox.y - rootBox.y - 1,
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
