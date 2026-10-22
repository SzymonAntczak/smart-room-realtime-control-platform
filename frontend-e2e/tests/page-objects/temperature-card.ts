import type { Locator, Page } from '@playwright/test';

export class TemperatureCard {
    readonly alert: Locator;
    readonly card: Locator;
    readonly heading: Locator;
    readonly reading: Locator;
    readonly status: Locator;

    constructor(page: Page, deviceId: string) {
        this.card = page.getByTestId(`${deviceId}-temperature-card`);
        this.heading = this.card.getByRole('heading');
        this.reading = page.getByTestId(`${deviceId}-temperature-reading`);
        this.status = page.getByTestId(`${deviceId}-temperature-card-status`);
        this.alert = page.getByTestId(`${deviceId}-temperature-alert`);
    }
}
