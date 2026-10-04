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
    readonly sidebar: Locator;
    readonly feedToggle: Locator;
    readonly feedEntries: Locator;
    readonly temperatureCard: TemperatureCard;
    readonly windowTemperatureCard: Locator;

    constructor(private readonly page: Page) {
        this.feed = page.getByRole('region', { name: 'Ostatnie istotne zdarzenia' });
        this.sidebar = page.getByRole('complementary', { name: 'Ostatnie istotne zdarzenia' });
        this.feedToggle = page.getByRole('button', { name: /ostatnie zdarzenia/i });
        this.feedEntries = this.feed.getByRole('listitem');
        this.temperatureCard = new TemperatureCard(page, 'temp-desk');
        this.windowTemperatureCard = page.getByTestId('temp-window-temperature-card');
    }

    entryContaining(text: string): Locator {
        return this.feedEntries.filter({ hasText: text });
    }

    eventTime(text: string): Locator {
        return this.entryContaining(text).getByRole('time');
    }

    eventDetails(text: string): Locator {
        return this.entryContaining(text).getByText('Szczegóły', { exact: true });
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

    async sidebarBounds(): Promise<ElementBounds> {
        return this.visibleBounds(this.sidebar);
    }

    async feedToggleBounds(): Promise<ElementBounds> {
        return this.visibleBounds(this.feedToggle);
    }

    async temperatureCardBounds(): Promise<ElementBounds> {
        return this.visibleBounds(this.temperatureCard.card);
    }

    async windowTemperatureCardBounds(): Promise<ElementBounds> {
        return this.visibleBounds(this.windowTemperatureCard);
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
