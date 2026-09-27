import { expect, test } from '@playwright/test';

import { resetMockRoom, setMockRoomSnapshot } from './mock-bff/mock-bff-control';
import { createOnlineTemperatureRoomSnapshot } from './mock-bff/mock-bff-fixtures';
import { RecentFeedDashboard } from './page-objects/recent-feed-dashboard';

test('keeps the feed beside cards and gives cards the freed width after collapse', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await resetMockRoom(page.request);
    await setMockRoomSnapshot(page.request, createOnlineTemperatureRoomSnapshot());
    const dashboard = new RecentFeedDashboard(page);
    await dashboard.open();

    await expect(dashboard.feed).toBeVisible();
    await expect(dashboard.temperatureCard.card).toBeVisible();
    await expect(dashboard.feedToggle).toHaveAttribute('aria-expanded', 'true');

    const openFeedBox = await dashboard.feedBounds();
    const openCardBox = await dashboard.temperatureCardBounds();

    expect(openFeedBox.x + openFeedBox.width).toBeLessThan(openCardBox.x);
    await dashboard.feedToggle.click();
    await expect(dashboard.feedToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(dashboard.feed).toBeHidden();

    const closedCardBox = await dashboard.temperatureCardBounds();
    const closedToggleBox = await dashboard.feedToggleBounds();

    expect(closedCardBox.width).toBeGreaterThan(openCardBox.width);
    expect(closedCardBox.x).toBeLessThan(openCardBox.x);
    expect(closedToggleBox.x).toBe(0);
    expect(closedToggleBox.y + closedToggleBox.height).toBeLessThan(closedCardBox.y);

    await dashboard.feedToggle.click();
    await expect(dashboard.feed).toBeVisible();
});

test('starts narrow views collapsed and stacks an opened feed above cards', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await resetMockRoom(page.request);
    await setMockRoomSnapshot(page.request, createOnlineTemperatureRoomSnapshot());
    const dashboard = new RecentFeedDashboard(page);
    await dashboard.open();

    await expect(dashboard.temperatureCard.card).toBeVisible();
    await expect(dashboard.feedToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(dashboard.feed).toBeHidden();

    await dashboard.feedToggle.click();
    await expect(dashboard.feed).toBeVisible();
    await expect(dashboard.feedToggle).toHaveAttribute('aria-expanded', 'true');

    const feedBox = await dashboard.feedBounds();
    const cardBox = await dashboard.temperatureCardBounds();

    expect(feedBox.y + feedBox.height).toBeLessThanOrEqual(cardBox.y);
    expect(await dashboard.hasNoHorizontalOverflow(390)).toBe(true);

    await dashboard.reload();
    await expect(dashboard.feedToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(dashboard.feed).toBeHidden();
});
