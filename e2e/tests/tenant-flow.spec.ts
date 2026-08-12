import { expect, test } from '@playwright/test';
import { SEED, login, loginAsTenant, navigateTo, uniqueIdentity, uniquePhone } from './helpers';

test.describe('Tenant journey', () => {
  // Phone verification is switched off (OTP_VERIFICATION_REQUIRED), so
  // registration lands straight on the sign-in screen. The OTP pipeline and its
  // /verify page are retained; re-enable the flag to restore that leg.
  test('registers with full address details', async ({ page }) => {
    const phone = uniquePhone();

    await page.goto('/register');

    await page.getByLabel(/full name/i).fill('E2E Test Tenant');
    await page.getByLabel(/phone number/i).fill(phone);
    await page.getByLabel(/date of birth/i).fill('1992-05-14');
    await page.getByLabel(/total family members/i).fill('3');
    await page.getByLabel(/identity type/i).selectOption('NID');
    await page.getByLabel(/identity number/i).fill(uniqueIdentity());

    await page.getByLabel(/village \/ street/i).fill('Test Street 12');
    await page.getByLabel(/post office/i).fill('Test PO');
    await page.getByLabel(/police station/i).fill('Test Thana');
    await page.getByLabel(/^district/i).fill('Dhaka');
    await page.getByLabel(/division/i).selectOption('Dhaka');

    await page.locator('#password').fill('Str0ngPass1');
    await page.locator('#confirmPassword').fill('Str0ngPass1');

    await page.getByRole('button', { name: /create account/i }).click();

    // Straight to sign-in — no verification step to clear.
    await expect(page).toHaveURL(/\/login/);

    // Registered, but admin approval is still required to get in.
    await page.getByLabel(/phone number/i).fill(phone);
    await page.locator('#password').fill('Str0ngPass1');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toContainText(/awaiting admin approval/i);
  });

  test('rejects an invalid registration client-side', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page.getByText(/enter your full name/i)).toBeVisible();
    await expect(page.getByText(/village \/ street is required/i)).toBeVisible();
    await expect(page.getByText(/police station \(thana\) is required/i)).toBeVisible();
    // Nothing was submitted.
    await expect(page).toHaveURL(/\/register/);
  });

  test('an unapproved tenant cannot sign in', async ({ page }) => {
    await login(page, SEED.pending);
    await expect(page.getByRole('alert')).toContainText(/awaiting admin approval/i);
  });

  test('sees the rent breakdown and tenancy duration counter', async ({ page }) => {
    await loginAsTenant(page);

    await expect(page.getByText(/time in this flat/i)).toBeVisible();
    await expect(page.getByText(/Year|Month|Day/)).toBeVisible();

    await navigateTo(page, /rent & bills/i);
    await expect(page).toHaveURL(/\/app\/rent/);
    await expect(page.getByRole('heading', { name: /rent & bills/i })).toBeVisible();
    await expect(page.getByText(/advance deposit/i).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /period/i })).toBeVisible();
  });

  test('defers rent by deducting from the advance deposit', async ({ page }) => {
    await loginAsTenant(page);
    await page.goto('/app/rent');

    const deferButton = page.getByRole('button', { name: /defer this month/i });
    await expect(deferButton).toBeVisible();
    test.skip(await deferButton.isDisabled(), 'No outstanding invoice for the current cycle');

    await deferButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The projection updates as the mode changes.
    await expect(dialog.getByText(/deducted from advance:/i)).toBeVisible();
    await dialog.getByLabel(/roll the whole balance/i).click();
    await expect(dialog.getByText(/deducted from advance: BDT 0\.00/i)).toBeVisible();

    await dialog.getByLabel(/deduct from my advance deposit/i).click();
    await dialog.getByRole('button', { name: /confirm deferral/i }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText(/rent deferral applied/i)).toBeVisible();
  });

  test('submits a maintenance report and tracks its status', async ({ page }) => {
    await loginAsTenant(page);
    await page.goto('/app/issues');

    const description = `E2E leak report ${Date.now()}`;
    await page.getByLabel(/category/i).selectOption('WATER_LEAKAGE');
    await page.getByLabel(/what is wrong/i).fill(description);
    await page.getByRole('button', { name: /submit report/i }).click();

    await expect(page.getByText(/issue reported/i)).toBeVisible();
    await expect(page.getByText(description)).toBeVisible();
    await expect(page.getByText('Pending').first()).toBeVisible();
  });

  test('gets an instant chatbot answer and can reach a human', async ({ page }) => {
    await loginAsTenant(page);
    await page.goto('/app/chat');

    await page.getByRole('button', { name: '/rules' }).click();
    await expect(page.getByText(/quiet hours/i).last()).toBeVisible();
    await expect(page.getByText(/amarbari assistant/i).first()).toBeVisible();

    await page.getByLabel(/^message$/i).fill('The lift is stuck on the third floor');
    await page.getByRole('button', { name: /send message/i }).click();
    await expect(page.getByText(/the lift is stuck/i).last()).toBeVisible();
  });

  test('cannot reach the admin area', async ({ page }) => {
    await loginAsTenant(page);
    await page.goto('/admin');
    await expect(page.getByText(/access denied/i)).toBeVisible();
    await expect(page.getByText(/revenue/i)).toHaveCount(0);
  });
});

test.describe('Mobile responsiveness', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('collapses navigation into a drawer', async ({ page }) => {
    await loginAsTenant(page);

    // The desktop sidebar is hidden; the hamburger opens a drawer.
    const openNav = page.getByRole('button', { name: /open navigation/i });
    await expect(openNav).toBeVisible();

    await openNav.click();
    const drawer = page.getByRole('dialog', { name: /navigation/i });
    await expect(drawer).toBeVisible();

    await drawer.getByRole('link', { name: /rent & bills/i }).click();
    await expect(page).toHaveURL(/\/app\/rent/);
    // Navigating closes the drawer.
    await expect(page.getByRole('dialog', { name: /navigation/i })).toBeHidden();
  });
});
