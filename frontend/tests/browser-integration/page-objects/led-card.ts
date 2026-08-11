import type { Locator, Page } from '@playwright/test';

export class LedCard {
    readonly commandStatus: Locator;
    readonly powerToggle: Locator;

    constructor(page: Page, deviceId: string) {
        this.commandStatus = page.getByTestId(`${deviceId}-command-status`);
        this.powerToggle = page.getByTestId(`${deviceId}-power-toggle`);
    }
}
