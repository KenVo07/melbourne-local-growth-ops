import { test, expect } from '@playwright/test';

test.describe('Ops Console E2E', () => {
  test('displays deployments with health status in registry', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Melbourne Local Growth Ops/);
    await expect(page.locator('h1')).toHaveText('Ops Console');
    
    // Wait for the table to populate
    await expect(page.locator('table.table tbody tr')).toHaveCount(4);
    
    // Verify health displays
    await expect(page.locator('text=dpl_prod_001').locator('..').locator('text=healthy')).toBeVisible();
    await expect(page.locator('text=dpl_test_002').locator('..').locator('text=degraded')).toBeVisible();
    await expect(page.locator('text=dpl_fail_003').locator('..').locator('text=failed')).toBeVisible();
    await expect(page.locator('text=dpl_unk_004').locator('..').locator('text=unknown')).toBeVisible();
  });

  test('filters events in Technical Audit Timeline', async ({ page }) => {
    // Go to dpl_prod_001
    await page.goto('/deployments/dpl_prod_001');

    await expect(page.locator('h3').first()).toHaveText('Configuration Details');
    await expect(page.locator('text=Technical Audit Timeline')).toBeVisible();

    // Verify all events
    await expect(page.locator('table.table').nth(1).locator('tbody tr')).toHaveCount(3);
    
    // Filter by BUILD
    await page.selectOption('select#category-filter', 'BUILD');
    await expect(page.locator('table.table').nth(1).locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('table.table').nth(1).locator('tbody tr').first()).toContainText('BUILD_COMPLETED');
  });

  test('gracefully handles missing events (unknown health)', async ({ page }) => {
    await page.goto('/deployments/dpl_unk_004');
    
    await expect(page.locator('h3').first()).toHaveText('Configuration Details');
    await expect(page.locator('text=Technical Audit Timeline')).toBeVisible();

    // Verify missing data state
    await expect(page.locator('text=Health: unknown')).toBeVisible();
    await expect(page.locator('text=No events found for this deployment.')).toBeVisible();
  });
});
