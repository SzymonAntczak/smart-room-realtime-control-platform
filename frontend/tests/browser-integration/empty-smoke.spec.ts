import { expect, test } from '@playwright/test';

test('starts the frontend integration test suite', async ({ page }) => {
    await expect(page).toHaveTitle('');
});
