import type { Locator, Page } from '@playwright/test';

import { TemperatureCard } from './temperature-card';

interface ElementBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class RecentFeedDashboard {
    readonly feed: Locator;
    readonly feedToggle: Locator;
    readonly temperatureCard: TemperatureCard;

    constructor(private readonly page: Page) {
        this.feed = page.getByRole('region', { name: 'Ostatnie istotne zdarzenia' });
        this.feedToggle = page.getByRole('button', { name: /ostatnie zdarzenia/i });
        this.temperatureCard = new TemperatureCard(page, 'temp-desk');
    }

    async open(): Promise<void> {
        await this.page.goto('/');
    }

    async reload(): Promise<void> {
        await this.page.reload();
    }

    async feedBounds(): Promise<ElementBounds> {
        return this.visibleBounds(this.feed);
    }

    async feedToggleBounds(): Promise<ElementBounds> {
        return this.visibleBounds(this.feedToggle);
    }

    async temperatureCardBounds(): Promise<ElementBounds> {
        return this.visibleBounds(this.temperatureCard.card);
    }

    async hasNoHorizontalOverflow(viewportWidth: number): Promise<boolean> {
        return (
            (await this.page.evaluate(() => document.documentElement.scrollWidth)) <= viewportWidth
        );
    }

    private async visibleBounds(locator: Locator): Promise<ElementBounds> {
        const bounds = await locator.boundingBox();

        if (!bounds) {
            throw new Error('The visible element must have a bounding box.');
        }

        return bounds;
    }
}
