import { test, expect } from '@playwright/test';

test.describe('Ops Console E2E', () => {
  test('has title and displays deployments', async ({ page }) => {
    await page.goto('/');

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/Melbourne Local Growth Ops/);

    // Expect to see the header
    await expect(page.locator('h1')).toHaveText('Ops Console');
    await expect(page.locator('h2')).toHaveText('Deployment Registry');

    // Wait for the table to populate (it simulates a network request of 500ms)
    const tableRow = page.locator('table.table tbody tr').first();
    await expect(tableRow).toBeVisible();

    // Click on the first "View Details" button
    await page.locator('text=View Details').first().click();

    // Verify detail page
    await expect(page.locator('h3').first()).toHaveText('Configuration Details');
    
    // Verify event inspector
    await expect(page.locator('text=Technical Event Inspector')).toBeVisible();
    await expect(page.locator('table.table').nth(1)).toBeVisible();
  });
});
