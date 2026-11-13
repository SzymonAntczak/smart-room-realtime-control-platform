import assert from 'node:assert/strict';

import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { acceptedCommandResponseSchema } from '@smart-room/contracts/commands';
import {
    type DeviceScenarioAction,
    deviceScenarioResultSchema,
} from '@smart-room/contracts/development';
import { isRoomBffSnapshot } from '@smart-room/contracts/room-bff';
import { isUserHistoryPage } from '@smart-room/contracts/user-history';
import { isSchema } from '@smart-room/contracts/validation';

import { smokeUrls } from '../smoke-urls';

const historyPath = '/room/history/user-history';
const desk = 'temp-desk';
const led = 'led-main';

test('both temperature sensors update their displayed observation time live', async ({ page }) => {
    await page.goto('/');

    for (const sensor of ['Temperatura biurka', 'Temperatura okna']) {
        await test.step(sensor, async () => {
            await page.getByRole('link', { name: `Szczegóły urządzenia: ${sensor}` }).click();
            const observationTime = page
                .getByRole('status', { name: 'Świeżość pomiaru' })
                .locator('time');
            await expect(observationTime).toBeVisible();
            const initialTime = Date.parse((await observationTime.getAttribute('datetime')) ?? '');
            expect(Number.isFinite(initialTime)).toBe(true);

            await expect
                .poll(
                    async () => Date.parse((await observationTime.getAttribute('datetime')) ?? ''),
                    { timeout: 25_000 },
                )
                .toBeGreaterThan(initialTime);
            await expect(observationTime).toBeVisible();
            await page.goBack();
        });
    }
});

test('confirms an LED command and shows its retained power change after reload', async ({
    page,
}) => {
    await page.goto('/');
    const toggle = page.getByTestId(`${led}-power-toggle`);
    const status = page.getByTestId(`${led}-command-status`);
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute('aria-pressed', /^(true|false)$/u);
    const pressed = await toggle.getAttribute('aria-pressed');
    assert(pressed === 'true' || pressed === 'false', 'Expected the reported LED power');
    const { nextPressed, previous, current } = {
        true: { nextPressed: 'false', previous: 'on', current: 'off' },
        false: { nextPressed: 'true', previous: 'off', current: 'on' },
    }[pressed];

    const commandResponse = page.waitForResponse(
        (response) =>
            response.url() === `${smokeUrls.bff}/room/commands` &&
            response.request().method() === 'POST',
    );
    await toggle.click();
    const admission = await commandResponse;
    expect(admission.status()).toBe(202);
    const command: unknown = await admission.json();

    assert(isSchema(acceptedCommandResponseSchema, command), 'Invalid command admission response');

    await expect(toggle).toHaveAttribute('aria-pressed', nextPressed);
    await expect(status).toContainText('Polecenie potwierdzone');
    const confirmed = await readRoom(page.request);
    expect(confirmed.recentCommands).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ commandId: command.commandId, status: 'confirmed' }),
        ]),
    );

    const firstPage = waitForHistoryPage(page, null);
    await page.reload();
    const history = await openHistory(page);
    const retained = (await firstPage).items.find(
        (item) =>
            item.kind === 'power_changed' &&
            item.deviceId === led &&
            item.previous === previous &&
            item.current === current,
    );

    assert(retained, 'The first durable history page is missing the LED power change');

    const entry = history.getByTestId(`history-item-${retained.recordId}`);
    await expect(entry).toBeInViewport();
    await expect(entry).toContainText('Zaobserwowano zmianę zasilania');
});

test('loads older history and preserves the reading position when live history arrives', async ({
    page,
}) => {
    for (let index = 0; index < 30; index += 1) {
        await runDeskScenario(page.request, 'degrade_device');
        await runDeskScenario(page.request, 'recover_device');
    }

    const firstResponse = waitForHistoryPage(page, null);
    await page.goto('/');
    const history = await openHistory(page);
    const firstPage = await firstResponse;
    const anchorItem = firstPage.items[14];

    assert(
        firstPage.nextCursor && anchorItem,
        'Expected a first page with an older page available',
    );

    const anchor = await scrollToOlderEntry(history, anchorItem.recordId);
    await expect(anchor).toBeInViewport({ ratio: 0.9 });
    await expect(anchor).toHaveAttribute('aria-posinset', '15');

    await runDeskScenario(page.request, 'degrade_device');
    await expect(anchor).toHaveAttribute('aria-posinset', '16');
    await expect(anchor).toBeInViewport({ ratio: 0.9 });
    const room = await readRoom(page.request);
    const live = room.userHistory[0];
    expect(live).toMatchObject({ deviceId: desk, kind: 'health_changed', current: 'degraded' });
    expect(firstPage.items.map(({ recordId }) => recordId)).not.toContain(live.recordId);

    const olderResponse = waitForHistoryPage(page, firstPage.nextCursor);
    await history.press('End');
    const olderPage = await olderResponse;
    expect(olderPage.throughSequence).toBe(firstPage.throughSequence);
    expect(olderPage.nextCursor).toBeNull();
    const oldest = olderPage.items.at(-1);

    assert(oldest, 'The cursor did not return an older history entry');

    // The virtual list keeps the previous reading position when a page arrives.
    // Wait for it to apply the final page before scrolling to the new end.
    await expect(
        history.getByRole('status').filter({ hasText: /koniec dostępnego zakresu/i }),
    ).toBeAttached();
    await history.press('End');
    await expect(history.getByTestId(`history-item-${oldest.recordId}`)).toBeInViewport();
    await page.getByRole('button', { name: 'Na górę', exact: true }).click();
    const liveEntry = history.getByTestId(`history-item-${live.recordId}`);
    await expect(liveEntry).toBeInViewport();
    await expect(liveEntry).toHaveAttribute('aria-posinset', '1');
});

async function openHistory(page: Page): Promise<Locator> {
    const toggle = page.getByRole('button', { name: /ostatnie zdarzenia/i });
    await expect(toggle).toBeVisible();

    if ((await toggle.getAttribute('aria-expanded')) === 'false') {
        await toggle.click();
    }

    const history = page.getByRole('region', { name: 'Przewijana historia zdarzeń' });
    await expect(history).toBeVisible();

    return history;
}

async function scrollToOlderEntry(history: Locator, recordId: string): Promise<Locator> {
    const entry = history.getByTestId(`history-item-${recordId}`);
    await expect
        .poll(async () => {
            if (!(await entry.count())) {
                await history.evaluate((element) => element.scrollBy(0, element.clientHeight / 2));
            }

            return entry.count();
        })
        .toBe(1);
    await entry.scrollIntoViewIfNeeded();

    return entry;
}

async function readRoom(request: APIRequestContext) {
    const response = await request.get(`${smokeUrls.bff}/room`);
    await expect(response).toBeOK();
    const snapshot: unknown = await response.json();

    if (!isRoomBffSnapshot(snapshot)) {
        throw new Error('Invalid room snapshot');
    }

    return snapshot;
}

async function waitForHistoryPage(page: Page, cursor: string | null) {
    const response = await page.waitForResponse((candidate) => {
        const url = new URL(candidate.url());

        return (
            url.origin === smokeUrls.bff &&
            url.pathname === historyPath &&
            url.searchParams.get('cursor') === cursor &&
            candidate.request().method() === 'GET'
        );
    });
    expect(response.status()).toBe(200);
    const history: unknown = await response.json();

    if (!isUserHistoryPage(history)) {
        throw new Error('Invalid durable history page');
    }

    return history;
}

async function runDeskScenario(request: APIRequestContext, action: DeviceScenarioAction) {
    const response = await request.post(`${smokeUrls.bff}/dev/devices/${desk}/scenarios`, {
        data: { action },
    });
    await expect(response).toBeOK();
    const result: unknown = await response.json();

    if (!isSchema(deviceScenarioResultSchema, result) || result.action !== action) {
        throw new Error(`Unexpected result for simulator action ${action}`);
    }
}
