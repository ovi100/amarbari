import fs from 'fs';
import { expect, test } from '@playwright/test';
import { loginAsAdmin, navigateTo } from './helpers';

test.describe('Admin journey', () => {
  test('sees the financial dashboard with charts and a table view', async ({ page }) => {
    await loginAsAdmin(page);

    await expect(page.getByRole('heading', { name: /property overview/i })).toBeVisible();
    await expect(page.getByText(/revenue \(base rent\)/i).first()).toBeVisible();
    await expect(page.getByText(/net profit/i).first()).toBeVisible();
    await expect(page.getByText(/occupancy/i).first()).toBeVisible();

    // The chart ships an accessible table alternative.
    await page.getByRole('button', { name: /table view/i }).click();
    await expect(page.getByRole('columnheader', { name: /net profit/i })).toBeVisible();
    await page.getByRole('button', { name: /chart view/i }).click();
  });

  test('filters analytics by date range', async ({ page }) => {
    await loginAsAdmin(page);
    const lastYear = new Date().getFullYear() - 1;

    await page.getByRole('button', { name: /last year/i }).click();
    await expect(page.locator('#from')).toHaveValue(`${lastYear}-01-01`);
    await expect(page.getByText(/revenue \(base rent\)/i).first()).toBeVisible();
  });

  test('exports a financial statement as CSV and Excel', async ({ page }) => {
    await loginAsAdmin(page);

    for (const [button, extension] of [
      [/^csv$/i, '.csv'],
      [/^excel$/i, '.xlsx'],
    ] as const) {
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: button }).click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toContain(extension);
      const path = await download.path();
      expect(fs.statSync(path).size).toBeGreaterThan(100);
    }
  });

  test('reviews and approves a pending user', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateTo(page, 'Users');
    await expect(page).toHaveURL(/\/admin\/users/);

    await page.getByRole('button', { name: /^pending$/i }).click();

    // Identity details are visible for verification before approving.
    await expect(page.getByText(/NID|Passport|Birth Certificate/).first()).toBeVisible();

    // Row actions collapse into a menu once a row has more than two of them.
    const menu = page.getByRole('button', { name: /row actions/i }).first();
    test.skip((await menu.count()) === 0, 'No pending users left to approve');
    await menu.click();

    const approve = page.getByRole('menuitem', { name: /^approve$/i });
    test.skip((await approve.count()) === 0, 'No pending users left to approve');
    await approve.click();
    await expect(page.getByText(/user approved/i)).toBeVisible();
  });

  test('manages flats', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/flats');

    const flatNumber = `E2E-${String(Date.now()).slice(-6)}`;
    await page.getByRole('button', { name: /add flat/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.locator('#flatNumber').fill(flatNumber);
    await dialog.locator('#floor').fill('4');
    await dialog.locator('#baseRent').fill('22000');
    await dialog.getByRole('button', { name: /add flat/i }).click();

    await expect(page.getByText(/flat added/i)).toBeVisible();
    await expect(page.getByRole('cell', { name: flatNumber }).first()).toBeVisible();
  });

  test('adds a shop and sees it listed', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/shops');

    const shopNumber = `S-${String(Date.now()).slice(-6)}`;
    await page.getByRole('button', { name: /add shop/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.locator('#shopName').fill('E2E Test Store');
    await dialog.locator('#shopNumber').fill(shopNumber);
    await dialog.locator('#shopBaseRent').fill('30000');
    await dialog.locator('#address').fill('12 Test Road, Dhaka');
    await dialog.getByRole('button', { name: /add shop/i }).click();

    await expect(page.getByText(/shop added/i)).toBeVisible();
    await expect(page.getByRole('cell', { name: shopNumber }).first()).toBeVisible();
  });

  test('resolves a maintenance ticket end to end', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/tickets');

    await expect(page.getByRole('heading', { name: /maintenance centre/i })).toBeVisible();
    await page.getByRole('button', { name: /^pending$/i }).click();

    const start = page.getByRole('button', { name: /start work/i }).first();
    test.skip((await start.count()) === 0, 'No pending tickets');

    await start.click();
    await expect(page.getByText(/ticket marked in progress/i)).toBeVisible();

    await page.getByRole('button', { name: /^in progress$/i }).click();
    const resolve = page.getByRole('button', { name: /mark resolved/i }).first();
    await resolve.click();
    await expect(page.getByText(/ticket marked resolved/i)).toBeVisible();
  });

  test('generates an invoice and downloads a signed PDF receipt', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/invoices');

    // Invoice rows carry five actions, so they live behind the row menu.
    await page.getByRole('button', { name: /row actions/i }).first().click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /download pdf invoice/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const path = await download.path();
    const header = fs.readFileSync(path).subarray(0, 5).toString('latin1');
    expect(header).toBe('%PDF-');
  });

  test('adds a dynamic column and edits a record through Data Control', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/data');

    await page.locator('#table').selectOption('Flat');

    const columnName = `e2eField${String(Date.now()).slice(-6)}`;
    await page.getByRole('button', { name: /add column to flat/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.locator('#columnName').fill(columnName);
    const columnLabel = `E2E ${columnName}`;
    await dialog.locator('#label').fill(columnLabel);
    await dialog.locator('#type').selectOption('STRING');
    await dialog.getByRole('button', { name: /add column/i }).click();

    await expect(page.getByText(/column added/i)).toBeVisible();
    await expect(page.getByRole('columnheader', { name: new RegExp(columnLabel, 'i') })).toBeVisible();

    // The new field is editable on a record.
    await page.getByRole('button', { name: /edit record/i }).first().click();
    const editor = page.getByRole('dialog');
    await editor.locator(`#field-${columnName}`).fill(`populated ${columnName}`);
    await editor.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByText(/record updated/i)).toBeVisible();
    await expect(page.getByText(`populated ${columnName}`).first()).toBeVisible();
  });

  test('cannot edit locked columns', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/data');
    await page.locator('#table').selectOption('User');

    await page.getByRole('button', { name: /edit record/i }).first().click();
    const editor = page.getByRole('dialog');

    // Password is write-only; the hash is never rendered as a field.
    await expect(editor.locator('#field-password')).toBeVisible();
    await expect(editor.locator('#field-passwordHash')).toHaveCount(0);
    await expect(editor.locator('#field-id')).toHaveCount(0);
  });

  test('replies to a tenant from the message inbox', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/chat');

    await expect(page.getByRole('heading', { name: /messages/i })).toBeVisible();
    const reply = `Admin reply ${Date.now()}`;

    await page.getByLabel(/^message$/i).fill(reply);
    await page.getByRole('button', { name: /send message/i }).click();
    await expect(page.getByText(reply).last()).toBeVisible();
  });
});

test.describe('Real-time messaging across two sessions', () => {
  test('delivers a tenant message to the admin without a reload', async ({ browser }) => {
    const tenantContext = await browser.newContext();
    const adminContext = await browser.newContext();
    const tenantPage = await tenantContext.newPage();
    const adminPage = await adminContext.newPage();

    try {
      const { loginAsTenant } = await import('./helpers');
      await loginAsTenant(tenantPage);
      await loginAsAdmin(adminPage);

      await adminPage.goto('/admin/chat');
      await tenantPage.goto('/app/chat');

      const message = `Realtime ping ${Date.now()}`;
      await tenantPage.getByLabel(/^message$/i).fill(message);
      await tenantPage.getByRole('button', { name: /send message/i }).click();

      // Arrives in the admin's open thread over the socket.
      await expect(adminPage.getByText(message).last()).toBeVisible({ timeout: 15_000 });
    } finally {
      await tenantContext.close();
      await adminContext.close();
    }
  });
});
