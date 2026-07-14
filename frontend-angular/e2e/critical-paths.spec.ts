import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e.admin@innovashift.local';
const EMP_EMAIL = process.env.E2E_EMP_EMAIL || 'e2e.staff@innovashift.local';
const PASSWORD = process.env.E2E_PASSWORD || 'E2e!Pass1234';

async function login(page: any, email: string, password: string) {
  await page.goto('/login?emulator=1');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expect(page.getByText(/organization:/i)).toBeVisible({ timeout: 15000 });
}

test.describe('Critical public/auth paths', () => {
  test('login page exposes register and forgot-password navigation', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: /create account/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible();
  });

  test('contact page has accessible demo form and submit button', async ({ page }) => {
    await page.goto('/contact?emulator=1');
    await expect(page.getByText(/request a demo/i)).toBeVisible();
    await expect(page.getByLabel(/full name/i)).toBeVisible();
    await expect(page.getByLabel(/organization/i)).toBeVisible();
    await expect(page.getByLabel(/work email/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send request/i })).toBeVisible();
  });
});

test.describe('Critical authenticated flows (seeded env)', () => {
  test('employee checks in/out with expected status transition', async ({ page }) => {
    await login(page, EMP_EMAIL, PASSWORD);
    await page.goto('/app/attendance?emulator=1');
    await expect(page.getByRole('heading', { name: /time & attendance/i })).toBeVisible();

    await expect(page.getByText(/my upcoming shifts/i)).toBeVisible({ timeout: 15000 });
    const clockIn = page.getByRole('button', { name: /clock in/i }).first();
    await expect(clockIn).toBeVisible({ timeout: 15000 });
    await clockIn.click();

    await expect(page.getByRole('button', { name: /clock out/i })).toBeVisible({ timeout: 10000 });
    const clockOut = page.getByRole('button', { name: /clock out/i }).first();
    await clockOut.click();

    await expect(page.getByRole('button', { name: /clock in/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test('employee submits correction, admin reviews and decides', async ({ browser }) => {
    const staffPage = await browser.newPage();
    const adminPage = await browser.newPage();

    await login(staffPage, EMP_EMAIL, PASSWORD);
    await staffPage.goto('/app/attendance?emulator=1');

    await expect(staffPage.getByText(/recent punches/i)).toBeVisible({ timeout: 15000 });
    const requestFixBtn = staffPage.getByRole('button', { name: /request fix/i }).first();
    await expect(requestFixBtn).toBeVisible({ timeout: 15000 });
    await requestFixBtn.click();

    await staffPage.getByLabel(/correction type/i).selectOption('wrong_hours');
    await staffPage.getByLabel(/correction reason/i).fill('Worked hours should include post-shift handoff.');
    await staffPage.getByRole('button', { name: /submit request/i }).click();

    await login(adminPage, ADMIN_EMAIL, PASSWORD);
    await adminPage.goto('/app/admin/employees/e2e-emp-uid?emulator=1');
    await expect(adminPage.getByRole('heading', { name: /employee details/i })).toBeVisible();

    const fixBtn = adminPage.getByRole('button', { name: /fix/i }).first();
    await expect(fixBtn).toBeVisible({ timeout: 12000 });
    await fixBtn.click();

    const applyBtn = adminPage.getByRole('button', { name: /apply fix/i });
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();

    await expect(adminPage.getByText(/approved|none|resolved/i).first()).toBeVisible({ timeout: 12000 });

    await staffPage.reload();
    await expect(staffPage.getByText(/approved|my correction requests/i).first()).toBeVisible({ timeout: 12000 });

    await staffPage.close();
    await adminPage.close();
  });
});
