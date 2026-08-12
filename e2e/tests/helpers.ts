import { Page, expect } from '@playwright/test';

export const SEED = {
  admin: { phone: '01700000000', password: 'Admin@12345' },
  tenant: { phone: '01711111111', password: 'Tenant@12345' },
  tenant2: { phone: '01722222222', password: 'Tenant@12345' },
  pending: { phone: '01744444444', password: 'Tenant@12345' },
};

export async function login(page: Page, who: { phone: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel(/phone number/i).fill(who.phone);
  await page.locator('#password').fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

export async function loginAsTenant(page: Page) {
  await login(page, SEED.tenant);
  await expect(page).toHaveURL(/\/app/);
}

export async function loginAsAdmin(page: Page) {
  await login(page, SEED.admin);
  await expect(page).toHaveURL(/\/admin/);
}

/**
 * Clicks a main-navigation link on either viewport: on mobile the sidebar is
 * collapsed behind the hamburger, so the drawer is opened first.
 */
export async function navigateTo(page: Page, name: string | RegExp) {
  const hamburger = page.getByRole('button', { name: /open navigation/i });
  if (await hamburger.isVisible()) {
    await hamburger.click();
    const drawer = page.getByRole('dialog', { name: /navigation/i });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name, exact: typeof name === 'string' }).click();
    return;
  }
  await page
    .getByRole('navigation')
    .getByRole('link', { name, exact: typeof name === 'string' })
    .click();
}

/** A phone number that will not collide with seeded or previous-run data. */
export function uniquePhone() {
  const tail = String(Date.now()).slice(-8);
  return `019${tail}`;
}

/** A valid 13-digit NID that will not collide with seeded or previous-run data. */
export function uniqueIdentity() {
  return `${String(Date.now()).slice(-9)}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;
}
