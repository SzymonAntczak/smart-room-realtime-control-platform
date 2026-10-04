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

    await page.setViewportSize({ width: 769, height: 900 });
    await expect.poll(async () => (await dashboard.sidebarBounds()).width).toBeLessThan(769);
    const breakpointDesktopSidebar = await dashboard.sidebarBounds();
    expect(breakpointDesktopSidebar.width).toBeLessThan(769);

    await page.setViewportSize({ width: 768, height: 900 });
    await expect
        .poll(async () => (await dashboard.sidebarBounds()).height)
        .toBeCloseTo(900 * 0.75, 0);
    const breakpointMobileSidebar = await dashboard.sidebarBounds();
    expect(breakpointMobileSidebar.width).toBeCloseTo(768, 0);
    expect(breakpointMobileSidebar.height).toBeCloseTo(900 * 0.75, 0);
});

for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 390 },
]) {
    test(`starts narrow views collapsed and overlays an opened feed at ${viewport.width}px`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        await resetMockRoom(page.request);
        await setMockRoomSnapshot(page.request, createOnlineTemperatureRoomSnapshot());
        const dashboard = new RecentFeedDashboard(page);
        await dashboard.open();

        await expect(dashboard.temperatureCard.card).toBeVisible();
        await expect(dashboard.feedToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(dashboard.feed).toBeHidden();

        const initialToggleBox = await dashboard.feedToggleBounds();
        expect(initialToggleBox.x + initialToggleBox.width / 2).toBeCloseTo(viewport.width / 2, 0);
        expect(initialToggleBox.y + initialToggleBox.height).toBeCloseTo(viewport.height, 0);

        const closedCardBox = await dashboard.temperatureCardBounds();
        await dashboard.feedToggle.click();
        await expect(dashboard.sidebar).toBeVisible();
        await expect(dashboard.feedToggle).toHaveAttribute('aria-expanded', 'true');
        await expect
            .poll(async () => (await dashboard.sidebarBounds()).y)
            .toBeCloseTo(viewport.height * 0.25, 0);

        const sidebarBox = await dashboard.sidebarBounds();
        const cardBox = await dashboard.temperatureCardBounds();
        const coveredCardBox = await dashboard.windowTemperatureCardBounds();
        const toggleBox = await dashboard.feedToggleBounds();
        const toggleShape = await dashboard.feedToggle.evaluate((element) => {
            const style = getComputedStyle(element);

            return {
                bottomBorder: style.borderBottomWidth,
                topLeftRadius: style.borderTopLeftRadius,
                topRightRadius: style.borderTopRightRadius,
            };
        });

        expect(sidebarBox.x).toBe(0);
        expect(sidebarBox.width).toBeCloseTo(viewport.width, 0);
        expect(sidebarBox.height).toBeCloseTo(viewport.height * 0.75, 0);
        expect(sidebarBox.y).toBeLessThan(coveredCardBox.y + coveredCardBox.height);
        expect(sidebarBox.y + sidebarBox.height).toBeGreaterThan(coveredCardBox.y);
        expect(cardBox.x).toBeCloseTo(closedCardBox.x, 0);
        expect(cardBox.y).toBeCloseTo(closedCardBox.y, 0);
        expect(toggleBox.x + toggleBox.width / 2).toBeCloseTo(viewport.width / 2, 0);
        expect(toggleBox.y + toggleBox.height).toBeCloseTo(sidebarBox.y, 0);
        expect(toggleShape).toEqual({
            bottomBorder: '0px',
            topLeftRadius: '8px',
            topRightRadius: '8px',
        });
        expect(await dashboard.hasNoHorizontalOverflow(viewport.width)).toBe(true);

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect.poll(async () => (await dashboard.feedToggleBounds()).y).toBe(toggleBox.y);

        await dashboard.feedToggle.focus();
        await page.keyboard.press('Enter');
        await expect(dashboard.feedToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(dashboard.feedToggle).toBeFocused();
        await expect(dashboard.feed).toBeHidden();
        await expect
            .poll(async () => (await dashboard.feedToggleBounds()).y)
            .toBeCloseTo(viewport.height - initialToggleBox.height, 0);

        const closedToggleBox = await dashboard.feedToggleBounds();
        expect(closedToggleBox.x + closedToggleBox.width / 2).toBeCloseTo(viewport.width / 2, 0);

        await dashboard.reload();
        await expect(dashboard.feedToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(dashboard.feed).toBeHidden();
    });
}
